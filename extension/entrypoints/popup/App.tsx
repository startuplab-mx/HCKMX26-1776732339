import { useState } from 'preact/hooks';
import './App.css';

function App() {
  const [count, setCount] = useState(0);

  // Replace these with your real UploadThing CDN URLs
  // (e.g. https://<APP_ID>.ufs.sh/f/<FILE_KEY>)
  const primarySvgUrl = 'https://<APP_ID>.ufs.sh/f/<FILE_KEY_1>';
  const secondarySvgUrl = 'https://<APP_ID>.ufs.sh/f/<FILE_KEY_2>';

  return (
    <>
      <div>
        <img src={'https://fhcznf55bc.ufs.sh/f/xBOsIwq3IZNgvmGZCQcnJ8kcASMhKDNE0Vly7aTGUo5f41pO'} 
          className="lumiHover" 
          alt="lumiWelcome"
         />
        <img
          src={'https://fhcznf55bc.ufs.sh/f/xBOsIwq3IZNgx3VFjIq3IZNgozUprDwMlXAWE5tQPbSFq6Om'}
          className="logo animated"
          alt="logoAnimated"
        />
         <img
          src={'https://fhcznf55bc.ufs.sh/f/xBOsIwq3IZNgFa5ypWQ9Ws2gLKNuOX813ZvTqdbyDx4krpRi'}
          className="dancing"
          alt="dancingLumi"
        />
         <img
          src={'https://fhcznf55bc.ufs.sh/f/xBOsIwq3IZNgU4J4BdPO5fgCtHEe8V0M7mXoSJu463RdyKnN'}
          className="sadLumi"
          alt="sadLumi"
        />
         <img
          src={'https://fhcznf55bc.ufs.sh/f/xBOsIwq3IZNgqJ3cdwSrNs3QtKcaYx6jbHAFPBm7Jdof2U1w'}
          className="OrangeLumi"
          alt="OrangeLumi"
        />
         <img
          src={'https://fhcznf55bc.ufs.sh/f/xBOsIwq3IZNgxpQvJ5q3IZNgozUprDwMlXAWE5tQPbSFq6Om'}
          className="redLumi"
          alt="redLumi"
        />
      </div>
      <h1>Popup</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
    </>
  );
}

export default App;
