const BASE_URL = (import.meta as any).env.VITE_API_URL || `http://${window.location.hostname}:5000`;
export default BASE_URL;