import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

type ParsedArgs = {
	name: string;
	baseDir: string;
	force: boolean;
};

function toPascalCase(value: string): string {
	return value
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}

function toCamelCase(value: string): string {
	const pascal = toPascalCase(value);
	return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function ensureParent(path: string) {
	mkdirSync(dirname(path), { recursive: true });
}

function writeSafe(path: string, content: string, force = false) {
	if (!force && existsSync(path)) {
		throw new Error(`File exists: ${path}`);
	}
	ensureParent(path);
	writeFileSync(path, content, "utf8");
}

function parseArgs(raw: string, fallbackBaseDir: string): ParsedArgs {
	const parts = raw.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) throw new Error("Name fehlt");
	const flags = new Set(parts.filter((p) => p.startsWith("--")));
	const values = parts.filter((p) => !p.startsWith("--"));
	const name = values[0];
	const baseDir = values[1] || fallbackBaseDir;
	return { name, baseDir, force: flags.has("--force") };
}

function createSliceTemplate(name: string) {
	const sliceName = toCamelCase(name);
	const stateType = `${toPascalCase(name)}State`;
	const initialState = `${sliceName}InitialState`;
	return `import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type ${stateType} = {
  loading: boolean;
  error: string | null;
};

const ${initialState}: ${stateType} = {
  loading: false,
  error: null,
};

export const ${sliceName}Slice = createSlice({
  name: "${sliceName}",
  initialState: ${initialState},
  reducers: {
    set${toPascalCase(name)}Loading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    set${toPascalCase(name)}Error: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    reset${toPascalCase(name)}State: () => ${initialState},
  },
});

export const {
  set${toPascalCase(name)}Loading,
  set${toPascalCase(name)}Error,
  reset${toPascalCase(name)}State,
} = ${sliceName}Slice.actions;

export const ${sliceName}Reducer = ${sliceName}Slice.reducer;
`;
}

function createApiTemplate(name: string) {
	const apiName = `${toCamelCase(name)}Api`;
	const tag = toPascalCase(name);
	const itemType = `${toPascalCase(name)}Item`;
	return `import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

export type ${itemType} = {
  id: string;
  name: string;
};

export const ${apiName} = createApi({
  reducerPath: "${apiName}",
  baseQuery: fetchBaseQuery({ baseUrl: "/api" }),
  tagTypes: ["${tag}"],
  endpoints: (builder) => ({
    get${toPascalCase(name)}: builder.query<${itemType}[], void>({
      query: () => "/${toCamelCase(name)}",
      providesTags: ["${tag}"],
    }),
    create${toPascalCase(name)}: builder.mutation<${itemType}, Partial<${itemType}>>({
      query: (body) => ({
        url: "/${toCamelCase(name)}",
        method: "POST",
        body,
      }),
      invalidatesTags: ["${tag}"],
    }),
  }),
});

export const {
  useGet${toPascalCase(name)}Query,
  useCreate${toPascalCase(name)}Mutation,
} = ${apiName};
`;
}

function createHooksTemplate(name: string) {
	const sliceName = toCamelCase(name);
	return `import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { set${toPascalCase(name)}Loading } from "./${sliceName}Slice";

export function use${toPascalCase(name)}State() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.${sliceName});

  return {
    ...state,
    setLoading: (value: boolean) => dispatch(set${toPascalCase(name)}Loading(value)),
  };
}
`;
}

function createIndexTemplate(name: string) {
	const sliceName = toCamelCase(name);
	const apiName = `${sliceName}Api`;
	return `export * from "./${sliceName}Slice";
export * from "./${apiName}";
export * from "./hooks";
`;
}

function createComponentTemplate(name: string) {
	const pascal = toPascalCase(name);
	const camel = toCamelCase(name);
	return `import React from "react";
import { useGet${pascal}Query } from "./${camel}Api";

export function ${pascal}Panel() {
  const { data = [], isLoading, error } = useGet${pascal}Query();

  if (isLoading) return <div>Loading ${camel}…</div>;
  if (error) return <div>Failed to load ${camel}.</div>;

  return (
    <section>
      <h2>${pascal}</h2>
      <ul>
        {data.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </section>
  );
}
`;
}

function createStoreSnippetTemplate(name: string) {
	const camel = toCamelCase(name);
	const pascal = toPascalCase(name);
	return `// app/store.ts
import { configureStore } from "@reduxjs/toolkit";
import { ${camel}Reducer } from "../features/${camel}/${camel}Slice";
import { ${camel}Api } from "../features/${camel}/${camel}Api";

export const store = configureStore({
  reducer: {
    ${camel}: ${camel}Reducer,
    [${camel}Api.reducerPath]: ${camel}Api.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(${camel}Api.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// app/hooks.ts
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "./store";

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

// optional usage
// <${pascal}Panel />
`;
}

function notifyFiles(ctx: ExtensionCommandContext, files: string[]) {
	ctx.ui.notify(`RTK erstellt: ${files.length} Dateien`, "info");
}

export default function rtkPlugin(pi: ExtensionAPI) {
	pi.registerCommand("rtk-slice", {
		description: "Create an RTK slice: /rtk-slice auth [src/features] [--force]",
		handler: async (args, ctx) => {
			const { name, baseDir, force } = parseArgs(args, "src/features");
			const dir = join(ctx.cwd, baseDir, toCamelCase(name));
			const file = join(dir, `${toCamelCase(name)}Slice.ts`);
			writeSafe(file, createSliceTemplate(name), force);
			notifyFiles(ctx, [file]);
		},
	});

	pi.registerCommand("rtk-api", {
		description: "Create an RTK Query API: /rtk-api users [src/features] [--force]",
		handler: async (args, ctx) => {
			const { name, baseDir, force } = parseArgs(args, "src/features");
			const dir = join(ctx.cwd, baseDir, toCamelCase(name));
			const file = join(dir, `${toCamelCase(name)}Api.ts`);
			writeSafe(file, createApiTemplate(name), force);
			notifyFiles(ctx, [file]);
		},
	});

	pi.registerCommand("rtk-feature", {
		description: "Create full RTK feature: /rtk-feature todos [src/features] [--force]",
		handler: async (args, ctx) => {
			const { name, baseDir, force } = parseArgs(args, "src/features");
			const camel = toCamelCase(name);
			const dir = join(ctx.cwd, baseDir, camel);
			const files = [
				join(dir, `${camel}Slice.ts`),
				join(dir, `${camel}Api.ts`),
				join(dir, `hooks.ts`),
				join(dir, `${toPascalCase(name)}Panel.tsx`),
				join(dir, `index.ts`),
				join(dir, `STORE_EXAMPLE.ts`),
			];
			writeSafe(files[0], createSliceTemplate(name), force);
			writeSafe(files[1], createApiTemplate(name), force);
			writeSafe(files[2], createHooksTemplate(name), force);
			writeSafe(files[3], createComponentTemplate(name), force);
			writeSafe(files[4], createIndexTemplate(name), force);
			writeSafe(files[5], createStoreSnippetTemplate(name), force);
			notifyFiles(ctx, files);
		},
	});

	pi.registerCommand("rtk-help", {
		description: "Show RTK plugin usage",
		handler: async (_args, ctx) => {
			ctx.ui.notify("/rtk-slice auth • /rtk-api users • /rtk-feature todos", "info");
		},
	});
}
