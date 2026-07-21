// Bumi & Bloom - Dashboard Logic

document.addEventListener('DOMContentLoaded', async () => {
  // Wait a tiny bit for auth to resolve
  setTimeout(loadDashboardData, 500);
});

async function loadDashboardData() {
  const supabase = window.bbSupabase.getClient();
  
  try {
    // 1. Fetch total products
    const { count: productsCount, error: productsError } = await supabase
      .from('Product')
      .select('*', { count: 'exact', head: true });
      
    if (!productsError) {
      document.getElementById('stat-products').textContent = productsCount;
    }
    
    // 2. Fetch total brands
    const { count: brandsCount, error: brandsError } = await supabase
      .from('Brand')
      .select('*', { count: 'exact', head: true });
      
    if (!brandsError) {
      document.getElementById('stat-brands').textContent = brandsCount;
    }
    
    // 3. Fetch active collections
    const { count: collectionsCount, error: collectionsError } = await supabase
      .from('Collection')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'PUBLISHED');
      
    if (!collectionsError) {
      document.getElementById('stat-collections').textContent = collectionsCount;
    }
    
    // 4. Fetch recent activity (AuditLog)
    const { data: logs, error: logsError } = await supabase
      .from('AuditLog')
      .select(`
        id,
        action,
        entity,
        entityId,
        actorEmail,
        createdAt
      `)
      .order('createdAt', { ascending: false })
      .limit(10);
      
    const tbody = document.getElementById('activity-table-body');
    
    if (logsError) {
      console.error("Error fetching logs:", logsError);
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--color-red);">Failed to load activity log.</td></tr>';
      return;
    }
    
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No recent activity.</td></tr>';
      return;
    }
    
    // Render logs
    tbody.innerHTML = logs.map(log => {
      const date = new Date(log.createdAt);
      
      // Extract verb from action like "product.create"
      let verb = log.action;
      if (verb.includes('.')) verb = verb.split('.')[1].toUpperCase();
      
      const actionBadge = `<span class="admin-badge ${getActionBadgeClass(verb)}">${verb}</span>`;
      const userName = log.actorEmail || 'Unknown User';
      
      return `
        <tr>
          <td>${actionBadge}</td>
          <td style="font-weight: var(--fw-semibold);">${log.entity}</td>
          <td style="color: var(--text-muted); font-family: monospace; font-size: 0.85rem;">${(log.entityId || '').substring(0, 8)}...</td>
          <td>${userName}</td>
          <td style="color: var(--text-muted);">${date.toLocaleString()}</td>
        </tr>
      `;
    }).join('');
    
  } catch (err) {
    console.error("Dashboard error:", err);
    window.bbAdminApp.showToast("Failed to load dashboard stats", "error");
  }
}

function getActionBadgeClass(action) {
  switch (action) {
    case 'CREATE': return 'success';
    case 'UPDATE': return 'warning';
    case 'DELETE': return 'danger';
    default: return 'neutral';
  }
}
