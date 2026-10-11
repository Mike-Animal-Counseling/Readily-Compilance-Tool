import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config({ ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'lib/pdf/pdf-worker.mjs'] }, ...tseslint.configs.recommended, { plugins: { 'react-hooks': hooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' } });
