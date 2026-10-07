import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

type PayState =
  | { stage: 'loading' }
  | { stage: 'invoice'; invoice: string; totalRwf: string; satsAmount: string; expiresAt: string }
  | { stage: 'paid'; settledAt: string }
  | { stage: 'expired' }
  | { stage: 'error'; message: string };

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    ref: params.get('ref') ?? '',
    amount: params.get('amount') ?? '',
    currency: params.get('currency') ?? 'RWF',
  };
}

export default function App() {
  const [state, setState] = useState<PayState>({ stage: 'loading' });
  const { ref, amount, currency } = getParams();

  // Step 1: Create (or fetch) the Lightning invoice on mount
  useEffect(() => {
    if (!ref || !amount) {
      setState({ stage: 'error', message: 'Invalid payment link — missing ref or amount.' });
      return;
    }

    fetch('/api/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, amount: parseFloat(amount), currency }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        if (!data.invoice?.paymentRequest) throw new Error('No Lightning invoice returned.');
        setState({
          stage: 'invoice',
          invoice: data.invoice.paymentRequest,
          totalRwf: data.totalRwf,
          satsAmount: data.satsAmount,
          expiresAt: data.expiresAt,
        });
      })
      .catch((e) => setState({ stage: 'error', message: e.message }));
  }, []);

  // Step 2: Poll payment status every 3 seconds until paid or expired
  useEffect(() => {
    if (state.stage !== 'invoice') return;

    const id = setInterval(() => {
      fetch(`/api/pay/${encodeURIComponent(ref)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.status === 'paid') {
            setState({ stage: 'paid', settledAt: data.settledAt ?? new Date().toISOString() });
          } else if (data.status === 'expired') {
            setState({ stage: 'expired' });
          }
        })
        .catch(() => {/* silently retry */});
    }, 3000);

    return () => clearInterval(id);
  }, [state.stage, ref]);

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'system-ui, sans-serif',
    backgroundColor: '#f7f7f7',
    padding: '20px',
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#fff',
    borderRadius: '16px',
    padding: '32px',
    maxWidth: '380px',
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
  };

  if (state.stage === 'loading') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ color: '#666' }}>⏳ Generating payment invoice…</p>
        </div>
      </div>
    );
  }

  if (state.stage === 'error') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h2 style={{ color: '#e00' }}>❌ Error</h2>
          <p style={{ color: '#555' }}>{state.message}</p>
        </div>
      </div>
    );
  }

  if (state.stage === 'paid') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: '64px' }}>✅</div>
          <h2 style={{ color: '#28a745', margin: '12px 0 8px' }}>Payment Received!</h2>
          <p style={{ color: '#555' }}>Thank you. Your payment has been confirmed.</p>
          <p style={{ fontSize: '0.8em', color: '#aaa', marginTop: '16px' }}>
            {new Date(state.settledAt).toLocaleString()}
          </p>
        </div>
      </div>
    );
  }

  if (state.stage === 'expired') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: '64px' }}>⏰</div>
          <h2 style={{ color: '#e00' }}>Invoice Expired</h2>
          <p style={{ color: '#555' }}>Please ask the seller to generate a new receipt.</p>
        </div>
      </div>
    );
  }

  // stage === 'invoice'
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 4px' }}>Pay with Bitcoin Lightning</h2>
        <p style={{ margin: '0 0 8px', color: '#555', fontSize: '0.9em' }}>Scan the QR code with your Lightning wallet</p>

        <div style={{ fontSize: '28px', fontWeight: 'bold', margin: '12px 0' }}>
          {Number(state.totalRwf).toLocaleString()} RWF
        </div>
        <div style={{ color: '#888', fontSize: '0.85em', marginBottom: '20px' }}>
          ≈ {Number(state.satsAmount).toLocaleString()} sats
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px', backgroundColor: '#f0f0f0', borderRadius: '12px' }}>
          <QRCodeSVG value={state.invoice} size={220} />
        </div>

        <p style={{ fontSize: '0.75em', color: '#aaa', marginTop: '16px' }}>
          Expires: {new Date(state.expiresAt).toLocaleTimeString()}
        </p>

        <p style={{ fontSize: '0.75em', color: '#bbb', marginTop: '4px' }}>
          Waiting for payment… 🔄
        </p>
      </div>
    </div>
  );
}
