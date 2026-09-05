import axios from 'axios';
import { Platform } from 'react-native';
import { storage } from '../services/storage';

const SERVER_IP = '13.207.68.220';
const HOST = Platform.OS === 'web' ? 'localhost' : SERVER_IP;
export const API_BASE_URL = Platform.OS === 'web' ? 'http://localhost:5000/api' : `http://${SERVER_IP}/api`;
export const WS_BASE_URL = Platform.OS === 'web' ? 'ws://localhost:5000/ws' : `ws://${SERVER_IP}/ws`;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

apiClient.interceptors.request.use(async (config) => {
  const token = await storage.getItem('agripump_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = await storage.getItem('agripump_refresh');
        if (refreshToken) {
          const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refresh_token: refreshToken });
          if (res.data.access_token) {
            await storage.setItem('agripump_token', res.data.access_token);
            if (res.data.refresh_token) {
              await storage.setItem('agripump_refresh', res.data.refresh_token);
            }
            originalRequest.headers.Authorization = `Bearer ${res.data.access_token}`;
            return apiClient(originalRequest);
          }
        }
      } catch (refreshErr) {
        await storage.clearAuth();
      }
    }
    return Promise.reject(error);
  }
);
