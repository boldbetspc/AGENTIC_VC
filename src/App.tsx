import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import PitchUs from "./pages/PitchUs";
import SuperLeague from "./pages/SuperLeague";

const App = () => {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return (
    <>
      <Toaster />
      {path === "/super-league" ? <SuperLeague /> : <PitchUs />}
    </>
  );
};

export default App;
