function App() {
  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      background: 'linear-gradient(135deg, #050507, #1a1033, #050507)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      fontFamily: 'sans-serif',
      fontSize: '24px'
    }}>
      <div>
        <h1 style={{ margin: 0 }}>ALOP-AI</h1>
        <p style={{ opacity: 0.6 }}>Test page is working</p>
        <input 
          type='text' 
          placeholder='Type here...' 
          style={{ 
            padding: '12px 20px', 
            borderRadius: '8px', 
            border: 'none', 
            marginTop: '20px',
            width: '300px'
          }}
        />
      </div>
    </div>
  );
}

export default App;