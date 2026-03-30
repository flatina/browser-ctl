import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		cdp: "src/cdp.ts",
		browser: "src/browser.ts",
	},
	format: "esm",
	dts: true,
	sourcemap: true,
	splitting: true,
	clean: true,
});
