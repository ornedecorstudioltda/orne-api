// shopify-proxy.js - VERSÃO OTIMIZADA
// API para buscar apenas pedidos NÃO ENTREGUES dos últimos 90 dias
// Com suporte a paginação, cache e filtros avançados

export default async function handler(req, res) {
    // ============================
    // 1. CONFIGURAÇÃO DE CORS
    // ============================
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Cache por 5 minutos para reduzir carga
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // ============================
    // 2. CONFIGURAÇÕES DA SHOPIFY
    // ============================
    const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
    const SHOP_DOMAIN = 'orne-decor-studio.myshopify.com';
    const API_VERSION = '2024-01';
    
    // Verificar token
    if (!SHOPIFY_TOKEN) {
        console.error('❌ Token da Shopify não configurado');
        return res.status(500).json({
            success: false,
            error: 'Token não configurado',
            orders: [],
            stats: {
                total: 0,
                filtered: 0,
                delivered: 0,
                active: 0
            }
        });
    }
    
    // ============================
    // 3. FUNÇÕES AUXILIARES
    // ============================
    
    // Verificar se pedido está entregue
    const isOrderDelivered = (order) => {
        // Verificar múltiplas condições de entrega
        
        // 1. Status de fulfillment
        if (order.fulfillment_status === 'fulfilled') {
            // Verificar se TODOS os fulfillments estão entregues
            if (order.fulfillments && order.fulfillments.length > 0) {
                const hasDelivered = order.fulfillments.some(f => 
                    f.shipment_status === 'delivered' || 
                    f.status === 'delivered'
                );
                if (hasDelivered) return true;
            }
        }
        
        // 2. Verificar tags
        if (order.tags) {
            const tagsLower = order.tags.toLowerCase();
            if (tagsLower.includes('entregue') || 
                tagsLower.includes('delivered') ||
                tagsLower.includes('finalizado') ||
                tagsLower.includes('concluido')) {
                return true;
            }
        }
        
        // 3. Verificar nota do pedido
        if (order.note) {
            const noteLower = order.note.toLowerCase();
            if (noteLower.includes('entregue') || 
                noteLower.includes('delivered')) {
                return true;
            }
        }
        
        // 4. Se o pedido tem mais de 60 dias E está fulfilled, considerar entregue
        const orderDate = new Date(order.created_at);
        const daysPassed = Math.floor((Date.now() - orderDate) / (1000 * 60 * 60 * 24));
        if (daysPassed > 60 && order.fulfillment_status === 'fulfilled') {
            return true;
        }
        
        return false;
    };
    
    // Filtrar pedidos válidos (não cancelados, não reembolsados, etc)
    const isValidOrder = (order) => {
        // Remover pedidos cancelados
        if (order.cancelled_at) return false;
        
        // Remover pedidos com problemas financeiros
        const invalidFinancialStatus = [
            'refunded',
            'partially_refunded', 
            'voided',
            'pending',
            null,
            undefined
        ];
        
        if (invalidFinancialStatus.includes(order.financial_status)) {
            return false;
        }
        
        // Manter apenas pedidos pagos ou autorizados
        const validFinancialStatus = ['paid', 'authorized', 'partially_paid'];
        return validFinancialStatus.includes(order.financial_status);
    };
    
    // Buscar uma página de pedidos
    const fetchOrdersPage = async (pageInfo = null) => {
        try {
            // Construir URL base
            const hoje = new Date();
            const dias90Atras = new Date(hoje.getTime() - (90 * 24 * 60 * 60 * 1000));
            
            let apiUrl = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders.json`;
            apiUrl += `?status=any&limit=250`;
            apiUrl += `&created_at_min=${dias90Atras.toISOString()}`;
            apiUrl += `&fields=id,name,created_at,customer,total_price,financial_status,fulfillment_status,fulfillments,tags,note,cancelled_at,tracking_numbers,line_items`;
            
            // Adicionar page_info se for paginação
            if (pageInfo) {
                apiUrl = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders.json?page_info=${pageInfo}&limit=250`;
            }
            
            console.log(`📦 Buscando página de pedidos...`);
            
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_TOKEN,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Shopify API erro: ${response.status}`);
            }
            
            // Extrair Link header para paginação
            const linkHeader = response.headers.get('Link');
            let nextPageInfo = null;
            
            if (linkHeader) {
                const matches = linkHeader.match(/<[^>]*page_info=([^>]*)>; rel="next"/);
                if (matches && matches[1]) {
                    nextPageInfo = matches[1].split('&')[0];
                }
            }
            
            const data = await response.json();
            
            return {
                orders: data.orders || [],
                nextPageInfo: nextPageInfo
            };
            
        } catch (error) {
            console.error('❌ Erro ao buscar página:', error);
            throw error;
        }
    };
    
    // ============================
    // 4. BUSCAR TODOS OS PEDIDOS
    // ============================
    
    try {
        console.log('🚀 Iniciando busca de pedidos não entregues...');
        
        let allOrders = [];
    let currentPageInfo = null;
    let pageCount = 0;
    const maxPages = 10; // Limite de segurança
    
    do {
        pageCount++;
        console.log(`\n🔄 Buscando página ${pageCount}...`);
        
        const pageData = await fetchOrdersPage(currentPageInfo);
        
        if (!pageData || !pageData.orders) {
            console.log('❌ Nenhum dado retornado, finalizando busca');
            break;
        }
        
        console.log(`✅ Página ${pageCount}: ${pageData.orders.length} pedidos encontrados`);
        
        // Adicionar pedidos desta página ao total
        allOrders = [...allOrders, ...pageData.orders];
        console.log(`📊 Total acumulado: ${allOrders.length} pedidos`);
        
        // Verificar se há próxima página
        currentPageInfo = pageData.nextPageInfo;
        
        if (!currentPageInfo) {
            console.log('✅ Última página alcançada');
        }
        
        // Proteção contra loop infinito
        if (pageCount >= maxPages) {
            console.log(`⚠️ Limite de ${maxPages} páginas atingido`);
            break;
        }
        
    } while (currentPageInfo);
    
    console.log(`\n🎯 BUSCA COMPLETA!`);
    console.log(`📦 Total de pedidos encontrados: ${allOrders.length}`);
    console.log(`📄 Total de páginas processadas: ${pageCount}`);
    
    // Retornar resposta com TODOS os pedidos
    return res.status(200).json({
        success: true,
        orders: allOrders,
        total: allOrders.length,
        pages: pageCount,
        message: `${allOrders.length} pedidos dos últimos 90 dias em ${pageCount} página(s)`
    });
        
        // ============================
        // 5. FILTRAR PEDIDOS
        // ============================
        
        // Filtrar pedidos válidos
        const validOrders = allOrders.filter(isValidOrder);
        console.log(`✅ Pedidos válidos: ${validOrders.length}`);
        
        // Separar entregues e não entregues
        const deliveredOrders = validOrders.filter(isOrderDelivered);
        const activeOrders = validOrders.filter(order => !isOrderDelivered(order));
        
        console.log(`📦 Pedidos ativos: ${activeOrders.length}`);
        console.log(`✅ Pedidos entregues (removidos): ${deliveredOrders.length}`);
        
        // ============================
        // 6. ADICIONAR ANÁLISE BÁSICA
        // ============================
        
        // Enriquecer pedidos com informações adicionais
        const enrichedOrders = activeOrders.map(order => {
            const createdDate = new Date(order.created_at);
            const daysPassed = Math.floor((Date.now() - createdDate) / (1000 * 60 * 60 * 24));
            
            // Coletar tracking numbers
            let trackingNumbers = [];
            
            // Do campo direto
            if (order.tracking_numbers && order.tracking_numbers.length > 0) {
                trackingNumbers = [...order.tracking_numbers];
            }
            
            // Dos fulfillments
            if (order.fulfillments) {
                order.fulfillments.forEach(f => {
                    if (f.tracking_number && !trackingNumbers.includes(f.tracking_number)) {
                        trackingNumbers.push(f.tracking_number);
                    }
                    if (f.tracking_numbers) {
                        f.tracking_numbers.forEach(tn => {
                            if (tn && !trackingNumbers.includes(tn)) {
                                trackingNumbers.push(tn);
                            }
                        });
                    }
                });
            }
            
            // Determinar urgência
            let urgencyLevel = 'normal';
            if (daysPassed > 30) {
                urgencyLevel = 'critical';
            } else if (daysPassed > 20) {
                urgencyLevel = 'high';
            } else if (daysPassed > 15) {
                urgencyLevel = 'medium';
            }
            
            return {
                ...order,
                // Adicionar campos calculados
                days_since_order: daysPassed,
                urgency_level: urgencyLevel,
                has_tracking: trackingNumbers.length > 0,
                all_tracking_numbers: trackingNumbers,
                tracking_number: trackingNumbers.join(', ') || null
            };
        });
        
        // Ordenar por urgência (mais antigos primeiro)
        enrichedOrders.sort((a, b) => b.days_since_order - a.days_since_order);
        
        // ============================
        // 7. ESTATÍSTICAS
        // ============================
        
        const stats = {
            total_fetched: allOrders.length,
            valid_orders: validOrders.length,
            delivered_filtered: deliveredOrders.length,
            active_orders: activeOrders.length,
            
            // Por urgência
            critical_orders: enrichedOrders.filter(o => o.urgency_level === 'critical').length,
            high_priority: enrichedOrders.filter(o => o.urgency_level === 'high').length,
            medium_priority: enrichedOrders.filter(o => o.urgency_level === 'medium').length,
            normal_priority: enrichedOrders.filter(o => o.urgency_level === 'normal').length,
            
            // Por status
            without_tracking: enrichedOrders.filter(o => !o.has_tracking).length,
            with_tracking: enrichedOrders.filter(o => o.has_tracking).length,
            
            // Resumo temporal
            last_30_days: enrichedOrders.filter(o => o.days_since_order <= 30).length,
            last_60_days: enrichedOrders.filter(o => o.days_since_order <= 60).length,
            over_60_days: enrichedOrders.filter(o => o.days_since_order > 60).length
        };
        
        console.log('📈 Estatísticas:', stats);
        
        // ============================
        // 8. RETORNAR RESPOSTA
        // ============================
        
        return res.status(200).json({
            success: true,
            orders: enrichedOrders,
            stats: stats,
            message: `${activeOrders.length} pedidos ativos encontrados (${deliveredOrders.length} entregues filtrados)`,
            generated_at: new Date().toISOString(),
            cache_duration: 300 // 5 minutos
        });
        
    } catch (error) {
        console.error('❌ ERRO GERAL:', error);
        
        return res.status(200).json({
            success: false,
            error: error.message,
            orders: [],
            stats: {
                total: 0,
                filtered: 0,
                delivered: 0,
                active: 0
            },
            message: 'Erro ao processar pedidos'
        });
    }
}
