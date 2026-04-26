import { useMemo } from 'preact/hooks';
import './App.css';

function App() {
  const logoAnimatedUrl =
    'https://fhcznf55bc.ufs.sh/f/xBOsIwq3IZNgx3VFjIq3IZNgozUprDwMlXAWE5tQPbSFq6Om';

  // Force the logo to "start fresh" on initial mount
  const logoSrc = useMemo(
    () => `${logoAnimatedUrl}?v=${Date.now()}`,
    [logoAnimatedUrl],
  );

  return (
    <>
      <main className="popup">
        <iframe
          className="logoAnimatedSmallFrame"
          title="Logo animated"
          src={logoSrc}
        />
      </main>
    </>
  );
}

export default App;
