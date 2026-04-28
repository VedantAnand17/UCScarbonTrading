/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        leaf: {
          50: "#effdf4",
          100: "#d8fbe4",
          200: "#b3f5cb",
          300: "#7eeaa8",
          400: "#45d781",
          500: "#1fbd62",
          600: "#139a4e",
          700: "#127941",
          800: "#135f37",
          900: "#114e30",
          950: "#042b19",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
