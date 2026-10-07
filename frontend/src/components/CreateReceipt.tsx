import { useState } from 'react';

export default function CreateReceipt({ onCreated }: { onCreated: (data: any) => void }) {
  const [amountRwf, setAmountRwf] = useState('');
  const [description, setDescription] = useState('Payment receipt');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/payments/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shop-api-key': 'my-super-secret-key'
        },
        body: JSON.stringify({
          orderId: `order-${Date.now()}`,
          description,
          amountRwf: parseInt(amountRwf, 10)
        })
      });
      const data = await res.json();
      if (data.order) {
        onCreated(data.order);
      } else {
        alert('Error: ' + JSON.stringify(data));
      }
    } catch (err) {
      alert('Error creating receipt');
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', maxWidth: '400px', margin: '0 auto', backgroundColor: '#fff', color: '#000' }}>
      <h2>Create Receipt</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <input 
          type="number" 
          placeholder="Amount (RWF)" 
          value={amountRwf} 
          onChange={(e) => setAmountRwf(e.target.value)} 
          required 
          style={{ padding: '8px' }}
        />
        <input 
          type="text" 
          placeholder="Description" 
          value={description} 
          onChange={(e) => setDescription(e.target.value)} 
          required 
          style={{ padding: '8px' }}
        />
        <button type="submit" disabled={loading} style={{ padding: '10px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '4px' }}>
          {loading ? 'Creating...' : 'Create Receipt'}
        </button>
      </form>
    </div>
  );
}
