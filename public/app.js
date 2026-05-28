import { setupEventListeners } from "./app/events.js?v=20260504-frontend-24";
import { loadSession } from "./app/session.js?v=20260504-frontend-24";

setupEventListeners();
void loadSession();
