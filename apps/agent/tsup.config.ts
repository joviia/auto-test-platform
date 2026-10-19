import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  // 工作区内部包全部内联；第三方依赖保持 external
  noExternal: [/^@atp\//],
})
