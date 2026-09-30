import { defineConfig } from 'orval';

// Regenerate with `npm run api:generate`. Input is exported from the backend by
// `python backend/scripts/export_farmer_openapi.py`; CI regenerates both and fails on any diff.
export default defineConfig({
  farmer: {
    input: { target: './openapi/farmer.json' },
    output: {
      mode: 'single',
      target: './src/api/generated/farmer.ts',
      schemas: './src/api/generated/model',
      client: 'react-query',
      httpClient: 'axios',
      clean: true,
      override: {
        mutator: { path: './src/api/http.ts', name: 'httpRequest' },
      },
    },
  },
  farmerZod: {
    input: { target: './openapi/farmer.json' },
    output: {
      mode: 'single',
      target: './src/api/generated/farmer.zod.ts',
      client: 'zod',
      clean: false,
    },
  },
});
