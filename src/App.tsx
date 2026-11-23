import { useEffect, useState } from "react";
import { backend, type AppUser } from "./lib/api";
import { AuthScreen } from "./components/AuthScreen";
import { Ledger } from "./components/Ledger";

export default function App() {
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);

  useEffect(() => {
    backend.getUser().then(setUser);
    return backend.onAuthChange(setUser);
  }, []);

  if (user === undefined) {
    return (
      <div className="loading-screen"><div className="spinner" /></div>
    );
  }
  return user ? <Ledger key={user.id} user={user} /> : <AuthScreen />;
}
