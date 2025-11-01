// src/context/AppContext.js
import { createContext } from 'react';

const AppCtx = createContext({
  user: null,
  profile: null,
  setProfile: () => {},
  signOut: () => {},
});

export default AppCtx;
