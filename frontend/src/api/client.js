import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:4000",
  timeout: 120000
});

export function apiError(error) {
  return error?.response?.data?.error || error?.message || "Request failed.";
}
