/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        gh: {
          bg: '#0d1117',
          card: '#161b22',
          border: '#30363d',
          text: '#c9d1d9',
          blue: '#58a6ff',
          green: '#238636',
          red: '#f85149',
          purple: '#8957e5'
        }
      }
    },
  },
  plugins: [],
}
