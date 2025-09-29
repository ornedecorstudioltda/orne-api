export default async function handler(req, res) {
    // Configurar CORS para permitir acesso do site
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Se for OPTIONS, retornar OK
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Token e domínio da Shopify
    const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
    const SHOP_DOMAIN = 'orne-decor-studio.myshopify.com';
    
    // Verificar se tem token
    if (!SHOPIFY_TOKEN) {
        console.error('ERRO: Token da Shopify não configurado');
        return res.status(500).json({
            success: false,
            error: 'Token da Shopify não configurado no Vercel',
            orders: [],
            total: 0
        });
    }
    
    try {
        console.log('Buscando pedidos da Shopify...');
        
        // Data de 90 dias atrás
        const hoje = new Date();
        const dias90Atras = new Date(hoje.getTime() - (90 * 24 * 60 * 60 * 1000));
        
        // URL da API da Shopify (250 é o máximo por página)
        const apiUrl = `https://${SHOP_DOMAIN}/admin/api/2024-01/orders.json?status=any&limit=250&created_at_min=${dias90Atras.toISOString()}`;
        
        console.log('URL da API:', apiUrl);
        
        // Buscar pedidos
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_TOKEN,
                'Content-Type': 'application/json'
            }
        });
        
        // Verificar resposta
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Erro da Shopify:', response.status, errorText);
            throw new Error(`Shopify retornou erro ${response.status}`);
        }
        
        // Pegar dados
        const data = await response.json();
        
        // Retornar sucesso
        return res.status(200).json({
            success: true,
            orders: data.orders || [],
            total: data.orders ? data.orders.length : 0,
            message: `${data.orders ? data.orders.length : 0} pedidos encontrados`
        });
        
    } catch (error) {
        console.error('ERRO:', error);
        
        // Retornar erro formatado
        return res.status(200).json({
            success: false,
            error: error.message,
            orders: [],
            total: 0,
            message: 'Erro ao buscar pedidos da Shopify'
        });
    }
}
