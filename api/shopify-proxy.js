export default async function handler(req, res) {
    // Headers CORS - permite acesso de qualquer origem
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Se for uma requisição OPTIONS, retorna OK
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Configurações da Shopify
    const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
    const SHOP_DOMAIN = 'orne-decor-studio.myshopify.com';
    
    try {
        console.log('Iniciando busca de pedidos dos últimos 90 dias...');
        
        // Calcular data de 90 dias atrás
        const today = new Date();
        const ninetyDaysAgo = new Date(today.getTime() - (90 * 24 * 60 * 60 * 1000));
        const startDate = ninetyDaysAgo.toISOString();
        
        // Array para armazenar todos os pedidos
        let allOrders = [];
        let hasMorePages = true;
        let pageInfo = null;
        let pageCount = 0;
        
        // Buscar todas as páginas de pedidos (Shopify limita a 250 por página)
        while (hasMorePages && pageCount < 10) { // Limite de segurança de 10 páginas (2500 pedidos)
            pageCount++;
            
            // Construir URL da API
            let apiUrl = `https://${SHOP_DOMAIN}/admin/api/2024-01/orders.json?`;
            apiUrl += `status=any&`;
            apiUrl += `limit=250&`; // Máximo permitido pela Shopify
            apiUrl += `created_at_min=${startDate}&`;
            apiUrl += `order=created_at desc`; // Mais recentes primeiro
            
            // Se tiver página seguinte, adicionar o parâmetro
            if (pageInfo) {
                apiUrl += `&page_info=${pageInfo}`;
            }
            
            console.log(`Buscando página ${pageCount} de pedidos...`);
            
            // Fazer requisição para Shopify
            const response = await fetch(apiUrl, {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_TOKEN,
                    'Content-Type': 'application/json'
                }
            });
            
            // Verificar se a resposta foi bem sucedida
            if (!response.ok) {
                console.error(`Erro na API Shopify: ${response.status}`);
                throw new Error(`Erro HTTP ${response.status}`);
            }
            
            // Pegar os dados
            const data = await response.json();
            
            // Adicionar pedidos ao array total
            if (data.orders && data.orders.length > 0) {
                allOrders = allOrders.concat(data.orders);
                console.log(`Página ${pageCount}: ${data.orders.length} pedidos encontrados`);
                
                // Verificar se tem mais páginas pelo header Link
                const linkHeader = response.headers.get('Link');
                if (linkHeader && linkHeader.includes('rel="next"')) {
                    // Extrair page_info do header
                    const matches = linkHeader.match(/page_info=([^&>]+)/);
                    if (matches && matches[1]) {
                        pageInfo = matches[1];
                    } else {
                        hasMorePages = false;
                    }
                } else {
                    hasMorePages = false;
                }
            } else {
                // Não tem mais pedidos
                hasMorePages = false;
            }
        }
        
        console.log(`Total de pedidos encontrados: ${allOrders.length}`);
        
        // Retornar todos os pedidos com sucesso
        return res.status(200).json({
            success: true,
            orders: allOrders,
            total: allOrders.length,
            message: `${allOrders.length} pedidos dos últimos 90 dias`
        });
        
    } catch (error) {
        console.error('Erro ao buscar pedidos:', error.message);
        
        // Retornar erro mas com estrutura consistente
        return res.status(200).json({
            success: false,
            orders: [],
            total: 0,
            error: error.message,
            message: 'Erro ao buscar pedidos da Shopify'
        });
    }
}
