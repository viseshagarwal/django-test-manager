import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: "module",
			globals: {
				...globals.node,
				...globals.es2020,
			},
			parserOptions: {
				project: "./tsconfig.json",
			},
		},
		files: ["src/**/*.ts"],
		rules: {
			// Allow unused vars with underscore prefix
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
			// Allow explicit any (common in VS Code extensions for dynamic data)
			"@typescript-eslint/no-explicit-any": "off",
			// Allow require statements (for dynamic requires)
			"@typescript-eslint/no-require-imports": "off",
			// Allow empty functions (common in VS Code extensions)
			"@typescript-eslint/no-empty-function": "off",
			// Semi-colons
			semi: ["error", "always"],
			// No console (allow for debugging in extensions)
			"no-console": "off",
		},
	},
	{
		ignores: [
			"out/**",
			"node_modules/**",
			"*.js",
			"*.mjs",
			"eslint.config.mjs",
		],
	}
);
