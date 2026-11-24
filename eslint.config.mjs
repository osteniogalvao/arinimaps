import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    // Regras feitas para o React Compiler, que este projeto não liga
    // (next.config.ts sem reactCompiler). Sem o compilador, Date.now() num
    // Server Component ou setState num efeito de carga não quebram nada:
    // ficam como aviso para revisar com calma, não barram a publicação.
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // não é código-fonte do site: cópias de trabalho, bibliotecas copiadas e dependências do worker
    ".claude/**",
    "founder/**", // artefatos locais da pesquisa de compradores, fora da aplicação
    ".impeccable/**",
    "public/vendor/**",
    "public/dev/**",
    "worker/node_modules/**",
  ]),
]);

export default eslintConfig;
