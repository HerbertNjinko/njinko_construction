import { setupEventListeners } from "./app/events.js?v=20260504-frontend-11";
import { loadSession } from "./app/session.js?v=20260504-frontend-11";

setupEventListeners();
void loadSession();
