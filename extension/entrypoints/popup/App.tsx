import './App.css';

function App() {
  const logoSrc = '/gifs/logo.gif';

  const openParentalControls = () => {
    const url = browser.runtime.getURL('/dashboard.html' as any);
    void browser.tabs.create({ url });
  };

  return (
    <>
      <main className="popup">
        <img className="logoAnimatedSmall" src={logoSrc} alt="Logo animated" />
        <button className="primaryButton" onClick={openParentalControls}>
          Control parental
        </button>
      </main>
    </>
  );
}

export default App;
