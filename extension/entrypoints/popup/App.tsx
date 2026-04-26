import './App.css';

function App() {
  const logoSrc = '/gifs/logo.gif';

  const openParentalControls = () => {
    // TODO: replace with your real parental controls destination
    const url = 'https://families.google.com/familylink/';
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
