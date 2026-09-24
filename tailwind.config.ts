import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f1f5ee",
          100: "#dfe9d7",
          200: "#c0d3b3",
          500: "#5c7d52",
          600: "#456140",
          700: "#354d32",
        },
        paper: {
          DEFAULT: "#f7f6f1",
          raised: "#ffffff",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(53, 45, 30, 0.04), 0 6px 20px -8px rgba(53, 45, 30, 0.12)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
