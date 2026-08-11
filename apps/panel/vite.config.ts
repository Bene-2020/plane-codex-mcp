import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({ plugins: [react(), viteSingleFile()], server: { port: 4318, proxy: { "/api": "http://127.0.0.1:4317", "/health": "http://127.0.0.1:4317" } } });
