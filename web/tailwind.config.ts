import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        satoshi: ["Satoshi", "sans-serif"],
        clash: ["ClashDisplay", "sans-serif"],
        "dm-sans": ["DM Sans", "sans-serif"],
        gilroy: ["Gilroy", "sans-serif"],
      },
      colors: {
        // Prototype dark glassmorphism palette
        brand: {
          bg: "#0e1117",
          "bg-alt": "#13171f",
          card: "rgba(255,255,255,0.05)",
          border: "rgba(255,255,255,0.08)",
          primary: "#6c5ce7",
          yes: "#355E3B",
          no: "#B1332F",
        },
      },
      backgroundImage: {
        "brown-gradient":
          "linear-gradient(135deg, #0e1117 0%, #1a1a2e 50%, #16213e 100%)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
