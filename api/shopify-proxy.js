// shopify-proxy.js - VERSÃO CORRIGIDA E OTIMIZADA
// API para buscar pedidos e analisar prazos de entrega
// Última atualização: Janeiro 2025

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
    const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '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';
    const SHOP_DOMAIN = process.env.SHOP_DOMAIN || 'orne-decor-studio.myshopify.com';
    const API_VERSION = '2024-01';
    const MAX_PAGES = parseInt(process.env.MAX_PAGES || '15'); // Aumentado para 15
    const DAYS_TO_FETCH = parseInt(process.env.DAYS_TO_FETCH || '90');
    
    // Log de configuração (apenas em dev)
    if (process.env.NODE_ENV !== 'production') {
        console.log('🔧 Configurações:', {
            shop: SHOP_DOMAIN,
            maxPages: MAX_PAGES,
            daysToFetch: DAYS_TO_FETCH,
            hasToken: !!SHOPIFY_TOKEN
        });
    }
    
    // Verificar token
    if (!SHOPIFY_TOKEN) {
        console.error('❌ Token da Shopify não configurado');
        return res.status(500).json({
            success: false,
            error: 'Token não configurado no servidor',
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
        // 1. Verificar fulfillments
        if (order.fulfillments && order.fulfillments.length > 0) {
            const hasDelivered = order.fulfillments.some(f => 
                f.shipment_status === 'delivered' || 
                f.status === 'delivered'
            );
            if (hasDelivered) return true;
        }
        
        // 2. Verificar tags
        if (order.tags) {
            const tagsLower = order.tags.toLowerCase();
            const deliveredTags = ['entregue', 'delivered', 'finalizado', 'concluido', 'completo'];
            if (deliveredTags.some(tag => tagsLower.includes(tag))) {
                return true;
            }
        }
        
        // 3. Verificar nota do pedido
        if (order.note) {
            const noteLower = order.note.toLowerCase();
            if (noteLower.includes('entregue') || noteLower.includes('delivered')) {
                return true;
            }
        }
        
        // 4. Se pedido tem mais de 60 dias E está fulfilled, presumir entregue
        if (order.fulfillment_status === 'fulfilled') {
            const orderDate = new Date(order.created_at);
            const daysPassed = Math.floor((Date.now() - orderDate) / (1000 * 60 * 60 * 24));
            if (daysPassed > 60) {
                return true;
            }
        }
        
        return false;
    };
    
    // Filtrar pedidos válidos
    const isValidOrder = (order) => {
        // Validar que o pedido tem dados mínimos
        if (!order || !order.id || !order.created_at) {
            return false;
        }
        
        // Remover pedidos cancelados
        if (order.cancelled_at || order.cancel_reason) {
            return false;
        }
        
        // Remover pedidos com status financeiro inválido
        const invalidFinancialStatus = ['refunded', 'voided'];
        if (invalidFinancialStatus.includes(order.financial_status)) {
            return false;
        }
        
        // Aceitar parcialmente reembolsados se ainda tem valor
        if (order.financial_status === 'partially_refunded') {
            const totalPrice = parseFloat(order.total_price || 0);
            const refundedAmount = parseFloat(order.total_refunds || 0);
            if (refundedAmount >= totalPrice) {
                return false;
            }
        }
        
        // Manter pedidos pendentes por até 7 dias
        if (order.financial_status === 'pending') {
            const orderDate = new Date(order.created_at);
            const daysPassed = Math.floor((Date.now() - orderDate) / (1000 * 60 * 60 * 24));
            if (daysPassed > 7) {
                return false;
            }
        }
        
        return true;
    };
    
    // Calcular nível de urgência
    const calculateUrgencyLevel = (daysPassed, hasTracking) => {
        if (!hasTracking) {
            // Sem tracking - prazos mais curtos
            if (daysPassed > 7) return 'critical';
            if (daysPassed > 5) return 'high';
            if (daysPassed > 3) return 'medium';
            return 'normal';
        } else {
            // Com tracking - prazos padrão
            if (daysPassed > 21) return 'critical';
            if (daysPassed > 16) return 'high';
            if (daysPassed > 13) return 'medium';
            return 'normal';
        }
    };
    
    // Buscar uma página de pedidos
    const fetchOrdersPage = async (pageInfo = null) => {
        try {
            // Construir URL
            const hoje = new Date();
            const diasAtras = new Date(hoje.getTime() - (DAYS_TO_FETCH * 24 * 60 * 60 * 1000));
            
            let apiUrl = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders.json`;
            
            if (pageInfo) {
                // Paginação - usar page_info
                apiUrl += `?page_info=${pageInfo}&limit=250`;
            } else {
                // Primeira página - usar filtros
                apiUrl += `?status=any&limit=250`;
                apiUrl += `&created_at_min=${diasAtras.toISOString()}`;
                apiUrl += `&fields=id,name,created_at,updated_at,customer,total_price,`;
                apiUrl += `financial_status,fulfillment_status,fulfillments,tags,note,`;
                apiUrl += `cancelled_at,cancel_reason,total_refunds,tracking_numbers,`;
                apiUrl += `line_items,shipping_lines,discount_codes`;
            }
            
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_TOKEN,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Shopify API erro ${response.status}:`, errorText);
                throw new Error(`Shopify API erro: ${response.status}`);
            }
            
            // Extrair Link header para paginação
            const linkHeader = response.headers.get('Link');
            let nextPageInfo = null;
            
            if (linkHeader) {
                const matches = linkHeader.match(/<[^>]*page_info=([^>&]*)[^>]*>; rel="next"/);
                if (matches && matches[1]) {
                    nextPageInfo = matches[1];
                }
            }
            
            const data = await response.json();
            
            return {
                orders: data.orders || [],
                nextPageInfo: nextPageInfo
            };
            
        } catch (error) {
            console.error('❌ Erro ao buscar página:', error.message);
            throw error;
        }
    };
    
    // ============================
    // 4. BUSCAR TODOS OS PEDIDOS
    // ============================
    
    try {
        console.log(`🚀 Iniciando busca de pedidos dos últimos ${DAYS_TO_FETCH} dias...`);
        
        let allOrders = [];
        let currentPageInfo = null;
        let pageCount = 0;
        
        // Buscar todas as páginas
        do {
            pageCount++;
            console.log(`📄 Buscando página ${pageCount}...`);
            
            const pageData = await fetchOrdersPage(currentPageInfo);
            
            if (!pageData || !pageData.orders || pageData.orders.length === 0) {
                console.log('✅ Sem mais pedidos para buscar');
                break;
            }
            
            console.log(`✅ Página ${pageCount}: ${pageData.orders.length} pedidos`);
            
            // Adicionar pedidos ao total
            allOrders = [...allOrders, ...pageData.orders];
            
            // Próxima página
            currentPageInfo = pageData.nextPageInfo;
            
            // Proteção contra loop infinito
            if (pageCount >= MAX_PAGES) {
                console.log(`⚠️ Limite de ${MAX_PAGES} páginas atingido`);
                break;
            }
            
        } while (currentPageInfo);
        
        console.log(`\n🎯 Busca completa: ${allOrders.length} pedidos em ${pageCount} páginas`);
        
        // ============================
        // 5. FILTRAR E PROCESSAR PEDIDOS
        // ============================
        
        console.log('🔍 Iniciando filtragem e análise...');
        
        // Filtrar pedidos válidos
        const validOrders = allOrders.filter(isValidOrder);
        console.log(`✅ Pedidos válidos: ${validOrders.length} (${allOrders.length - validOrders.length} removidos)`);
        
        // Separar entregues e ativos
        const deliveredOrders = [];
        const activeOrders = [];
        
        validOrders.forEach(order => {
            if (isOrderDelivered(order)) {
                deliveredOrders.push(order);
            } else {
                activeOrders.push(order);
            }
        });
        
        console.log(`📦 Pedidos ativos: ${activeOrders.length}`);
        console.log(`✅ Pedidos entregues: ${deliveredOrders.length}`);
        
        // ============================
        // 6. ENRIQUECER PEDIDOS ATIVOS
        // ============================
        
        const enrichedOrders = activeOrders.map(order => {
            const createdDate = new Date(order.created_at);
            const daysPassed = Math.floor((Date.now() - createdDate) / (1000 * 60 * 60 * 24));
            
            // Coletar todos os tracking numbers
            const trackingNumbers = [];
            const trackingSet = new Set();
            
            // Do campo direto
            if (order.tracking_numbers && Array.isArray(order.tracking_numbers)) {
                order.tracking_numbers.forEach(tn => {
                    if (tn && !trackingSet.has(tn)) {
                        trackingSet.add(tn);
                        trackingNumbers.push(tn);
                    }
                });
            }
            
            // Dos fulfillments
            if (order.fulfillments && Array.isArray(order.fulfillments)) {
                order.fulfillments.forEach(f => {
                    // Tracking único
                    if (f.tracking_number && !trackingSet.has(f.tracking_number)) {
                        trackingSet.add(f.tracking_number);
                        trackingNumbers.push(f.tracking_number);
                    }
                    // Array de trackings
                    if (f.tracking_numbers && Array.isArray(f.tracking_numbers)) {
                        f.tracking_numbers.forEach(tn => {
                            if (tn && !trackingSet.has(tn)) {
                                trackingSet.add(tn);
                                trackingNumbers.push(tn);
                            }
                        });
                    }
                });
            }
            
            const hasTracking = trackingNumbers.length > 0;
            const urgencyLevel = calculateUrgencyLevel(daysPassed, hasTracking);
            
            // Determinar status de prazo
            let prazoStatus = 'no_prazo';
            if (!hasTracking) {
                prazoStatus = daysPassed > 7 ? 'aguardando_urgente' : 'aguardando';
            } else {
                if (daysPassed > 20) prazoStatus = 'critico';
                else if (daysPassed > 15) prazoStatus = 'atrasado';
                else if (daysPassed > 12) prazoStatus = 'alerta';
                else prazoStatus = 'no_prazo';
            }
            
            return {
                ...order,
                // Campos calculados
                days_since_order: daysPassed,
                urgency_level: urgencyLevel,
                prazo_status: prazoStatus,
                has_tracking: hasTracking,
                all_tracking_numbers: trackingNumbers,
                tracking_number: trackingNumbers.join(', ') || null,
                is_late: daysPassed > (hasTracking ? 15 : 7),
                // Análise compatível com o dashboard
                analysis: {
                    daysPassed: daysPassed,
                    status: urgencyLevel === 'critical' ? 'critical' : 
                            urgencyLevel === 'high' ? 'late' : 
                            urgencyLevel === 'medium' ? 'warning' : 'normal',
                    prazoStatus: prazoStatus,
                    priority: urgencyLevel === 'critical' ? 10 :
                             urgencyLevel === 'high' ? 8 :
                             urgencyLevel === 'medium' ? 5 : 2,
                    isLate: daysPassed > (hasTracking ? 15 : 7),
                    isDelivered: false,
                    hasTracking: hasTracking,
                    trackingNumbers: trackingNumbers
                }
            };
        });
        
        // Ordenar por urgência (mais críticos primeiro)
        enrichedOrders.sort((a, b) => {
            // Primeiro por urgência
            const urgencyOrder = { critical: 4, high: 3, medium: 2, normal: 1 };
            const urgencyDiff = urgencyOrder[b.urgency_level] - urgencyOrder[a.urgency_level];
            if (urgencyDiff !== 0) return urgencyDiff;
            
            // Depois por dias
            return b.days_since_order - a.days_since_order;
        });
        
        // ============================
        // 7. CALCULAR ESTATÍSTICAS
        // ============================
        
        const stats = {
            // Totais
            total_fetched: allOrders.length,
            total_invalid: allOrders.length - validOrders.length,
            valid_orders: validOrders.length,
            delivered_filtered: deliveredOrders.length,
            active_orders: activeOrders.length,
            
            // Por urgência
            critical_orders: enrichedOrders.filter(o => o.urgency_level === 'critical').length,
            high_priority: enrichedOrders.filter(o => o.urgency_level === 'high').length,
            medium_priority: enrichedOrders.filter(o => o.urgency_level === 'medium').length,
            normal_priority: enrichedOrders.filter(o => o.urgency_level === 'normal').length,
            
            // Por tracking
            without_tracking: enrichedOrders.filter(o => !o.has_tracking).length,
            with_tracking: enrichedOrders.filter(o => o.has_tracking).length,
            
            // Por prazo
            late_orders: enrichedOrders.filter(o => o.is_late).length,
            on_time_orders: enrichedOrders.filter(o => !o.is_late).length,
            
            // Temporal
            last_7_days: enrichedOrders.filter(o => o.days_since_order <= 7).length,
            last_15_days: enrichedOrders.filter(o => o.days_since_order <= 15).length,
            last_30_days: enrichedOrders.filter(o => o.days_since_order <= 30).length,
            over_30_days: enrichedOrders.filter(o => o.days_since_order > 30).length,
            
            // Percentuais
            late_percentage: activeOrders.length > 0 ? 
                ((enrichedOrders.filter(o => o.is_late).length / activeOrders.length) * 100).toFixed(1) : 0,
            tracking_percentage: activeOrders.length > 0 ?
                ((enrichedOrders.filter(o => o.has_tracking).length / activeOrders.length) * 100).toFixed(1) : 0
        };
        
        console.log('📊 Estatísticas calculadas:', stats);
        
        // ============================
        // 8. RETORNAR RESPOSTA COMPLETA
        // ============================
        
        const response = {
            success: true,
            orders: enrichedOrders,
            stats: stats,
            message: `${activeOrders.length} pedidos ativos analisados com sucesso`,
            metadata: {
                generated_at: new Date().toISOString(),
                cache_duration: 300,
                days_fetched: DAYS_TO_FETCH,
                pages_processed: pageCount,
                version: '2.0'
            }
        };
        
        console.log(`✅ Resposta pronta com ${enrichedOrders.length} pedidos processados`);
        
        return res.status(200).json(response);
        
    } catch (error) {
        console.error('❌ ERRO GERAL:', error.message);
        console.error(error.stack);
        
        // Resposta de erro estruturada
        return res.status(500).json({
            success: false,
            error: error.message,
            orders: [],
            stats: {
                total_fetched: 0,
                valid_orders: 0,
                delivered_filtered: 0,
                active_orders: 0,
                critical_orders: 0
            },
            message: `Erro ao processar pedidos: ${error.message}`,
            metadata: {
                generated_at: new Date().toISOString(),
                version: '2.0'
            }
        });
    }
}
