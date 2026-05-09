import { API_BASE_URL } from './config.js';

export const getServices = async () => {
  const response = await fetch(`${API_BASE_URL}/services`);

  if (!response.ok) {
    throw new Error("Failed to fetch services");
  }

  return response.json();
};