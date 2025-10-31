/** @type {import('tailwindcss').Config} */
module.exports = {
  // อัปเดต path ให้ครอบคลุมไฟล์ที่คุณใช้ className
  content: ["./App.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: { extend: {} },
  plugins: [],
};
