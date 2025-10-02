// API VERCEL - DETALHES COMPLETOS DO PEDIDO
// Arquivo: api/order-details.js
// Criado em: Janeiro 2025
// Função: Buscar TODOS os detalhes de um pedido específico da Shopify

export default async function handler(req, res) {
  // Configurar CORS para permitir acesso do seu site
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Se for OPTIONS (preflight), retornar OK
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Só aceitar método GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    // Pegar o ID do pedido da URL
    const { orderId } = req.query;
    
    if (!orderId) {
      return res.status(400).json({ error: 'ID do pedido é obrigatório' });
    }

    console.log(`Buscando detalhes do pedido: ${orderId}`);

    // Suas credenciais da Shopify (vêm das variáveis de ambiente)
    const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'ornedecor.myshopify.com';
    const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!SHOPIFY_ACCESS_TOKEN) {
      console.error('Token de acesso não configurado');
      return res.status(500).json({ error: 'Configuração da API incompleta' });
    }

    // URL da API da Shopify para buscar o pedido
    const shopifyUrl = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders/${orderId}.json`;
    
    // Fazer requisição para a Shopify
    const response = await fetch(shopifyUrl, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('Erro da Shopify:', response.status);
      const errorText = await response.text();
      console.error('Detalhes do erro:', errorText);
      
      if (response.status === 404) {
        return res.status(404).json({ error: 'Pedido não encontrado' });
      }
      
      return res.status(response.status).json({ 
        error: 'Erro ao buscar pedido na Shopify',
        details: errorText 
      });
    }

    const data = await response.json();
    const order = data.order;

    // Buscar informações do cliente (histórico de pedidos)
    let customerOrders = 0;
    if (order.customer && order.customer.id) {
      try {
        const customerUrl = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/customers/${order.customer.id}/orders/count.json`;
        const customerResponse = await fetch(customerUrl, {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
          }
        });
        
        if (customerResponse.ok) {
          const customerData = await customerResponse.json();
          customerOrders = customerData.count || 0;
        }
      } catch (error) {
        console.log('Erro ao buscar histórico do cliente:', error);
      }
    }

    // Processar dados para o formato que precisamos
    const processedOrder = {
      // Informações básicas
      id: order.id,
      order_number: order.order_number,
      name: order.name,
      created_at: order.created_at,
      updated_at: order.updated_at,
      processed_at: order.processed_at,
      
      // Status
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status || 'unfulfilled',
      cancelled_at: order.cancelled_at,
      cancel_reason: order.cancel_reason,
      
      // Valores
      currency: order.currency,
      subtotal_price: order.subtotal_price,
      total_discounts: order.total_discounts,
      total_line_items_price: order.total_line_items_price,
      total_price: order.total_price,
      total_tax: order.total_tax,
      total_shipping_price_set: order.total_shipping_price_set,
      
      // Informações de pagamento
      payment_gateway_names: order.payment_gateway_names || [],
      gateway: order.gateway,
      
      // Cliente
      customer: order.customer ? {
        id: order.customer.id,
        email: order.customer.email,
        first_name: order.customer.first_name,
        last_name: order.customer.last_name,
        phone: order.customer.phone,
        total_spent: order.customer.total_spent,
        orders_count: customerOrders,
        tags: order.customer.tags,
        note: order.customer.note
      } : null,
      
      // Endereço de entrega
      shipping_address: order.shipping_address ? {
        first_name: order.shipping_address.first_name,
        last_name: order.shipping_address.last_name,
        company: order.shipping_address.company, // CPF/CNPJ
        address1: order.shipping_address.address1,
        address2: order.shipping_address.address2,
        city: order.shipping_address.city,
        province: order.shipping_address.province,
        province_code: order.shipping_address.province_code,
        country: order.shipping_address.country,
        country_code: order.shipping_address.country_code,
        zip: order.shipping_address.zip,
        phone: order.shipping_address.phone,
        latitude: order.shipping_address.latitude,
        longitude: order.shipping_address.longitude
      } : null,
      
      // Endereço de cobrança
      billing_address: order.billing_address,
      
      // Produtos
      line_items: order.line_items ? order.line_items.map(item => ({
        id: item.id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        title: item.title,
        variant_title: item.variant_title,
        sku: item.sku,
        vendor: item.vendor,
        quantity: item.quantity,
        price: item.price,
        total_discount: item.total_discount,
        fulfillment_status: item.fulfillment_status,
        properties: item.properties || []
      })) : [],
      
      // Fulfillments (envios)
      fulfillments: order.fulfillments ? order.fulfillments.map(f => ({
        id: f.id,
        status: f.status,
        created_at: f.created_at,
        updated_at: f.updated_at,
        tracking_company: f.tracking_company,
        tracking_number: f.tracking_number,
        tracking_numbers: f.tracking_numbers || [],
        tracking_urls: f.tracking_urls || [],
        shipment_status: f.shipment_status,
        line_items: f.line_items
      })) : [],
      
      // Descontos
      discount_codes: order.discount_codes || [],
      discount_applications: order.discount_applications || [],
      
      // Frete
      shipping_lines: order.shipping_lines ? order.shipping_lines.map(s => ({
        id: s.id,
        title: s.title,
        price: s.price,
        code: s.code,
        source: s.source,
        carrier_identifier: s.carrier_identifier,
        requested_fulfillment_service_id: s.requested_fulfillment_service_id
      })) : [],
      
      // Tags e notas
      tags: order.tags,
      note: order.note,
      note_attributes: order.note_attributes || [],
      
      // Informações adicionais
      cart_token: order.cart_token,
      checkout_token: order.checkout_token,
      source_name: order.source_name,
      source_identifier: order.source_identifier,
      source_url: order.source_url,
      landing_site: order.landing_site,
      referring_site: order.referring_site,
      
      // Campos customizados (da sua loja)
      aliexpress_order: null,
      account_id: null
    };
    
    // Procurar informações do AliExpress nas notas
    if (order.note_attributes && Array.isArray(order.note_attributes)) {
      const aliOrderAttr = order.note_attributes.find(attr => 
        attr.name === 'aliexpress_order' || 
        attr.name === 'AliExpress Order'
      );
      if (aliOrderAttr) {
        processedOrder.aliexpress_order = aliOrderAttr.value;
      }
      
      const accountAttr = order.note_attributes.find(attr => 
        attr.name === 'account_id' || 
        attr.name === 'Account ID'
      );
      if (accountAttr) {
        processedOrder.account_id = accountAttr.value;
      }
    }
    
    // Retornar dados processados
    res.status(200).json({
      success: true,
      order: processedOrder
    });

  } catch (error) {
    console.error('Erro ao buscar detalhes do pedido:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
}
