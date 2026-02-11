import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    build: {
        lib: {
            entry: path.resolve(__dirname, 'src/main.ts'),
            name: 'pf2e-auto-action-tracker',
            formats: ['es'],
            fileName: 'main'
        },
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
        // We remove the assetFileNames logic because 'public' handles the CSS now
        rollupOptions: {
            external: [],
        },
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
});