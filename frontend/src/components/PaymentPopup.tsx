import { QRCodeSVG } from 'qrcode.react';

export default function PaymentPopup({ order, onClose }: { order: any, onClose: () => void }) {
  if (!order) return null;
  
  // The QR code contains the Lightning Network invoice.
  // When scanned by a Lightning wallet, it processes the payment.
  const qrData = order.invoice?.paymentRequest || `order:${order.orderId}`;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{ padding: '30px', backgroundColor: '#fff', borderRadius: '12px', textAlign: 'center', color: '#000', maxWidth: '400px', width: '100%' }}>
        <h2>Pay Receipt</h2>
        <p>Amount: <strong>{order.totalRwf} RWF</strong></p>
        <p style={{ fontSize: '0.9em', color: '#666' }}>Order ID: {order.orderId}</p>
        
        <div style={{ margin: '20px 0' }}>
          <h4>Scan to Pay</h4>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <QRCodeSVG value={qrData} size={200} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '4px', border: '1px solid #ccc', background: '#eee', cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  );
}
