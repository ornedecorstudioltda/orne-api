export default async function handler(req, res) {
    // Headers CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
    const SHOP_DOMAIN = 'orne-decor-studio.myshopify.com';
    
    try {
        const apiUrl = `https://${SHOP_DOMAIN}/admin/api/2024-01/orders.json?status=any&limit=10000`;
        
        const response = await fetch(apiUrl, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_TOKEN,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            console.error('Erro:', response.status);
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        return res.status(200).json(data);
        
    } catch (error) {
        console.error('Erro:', error.message);
        return res.status(200).json({
            orders: [],
            error: error.message
        });
    }
}
cd ..
