import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 900: "#0d2137", 800: "#1a3a5c", 700: "#24507c" },
        brand: { orange: "#f5922e", blue: "#3d7ab5" },
      },
    },
  },
  plugins: [],
} satisfies Config;
