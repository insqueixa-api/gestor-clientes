const fs = require('fs');
let c = fs.readFileSync('app/admin/settings/financeiro_pessoal/page.tsx', 'utf8');

const badBlock = `      <div className="h-24 sm:h-20" />
      {/* CSS PARA OCULTAR VALORES COM O EYE-TOGGLE */}
      <style
        dangerouslySetInnerHTML={{
          __html: \`
        #dashboard-values[data-values-hidden="true"] .finance-value {
          filter: blur(8px);
          opacity: 0.6;
          pointer-events: none;
          user-select: none;
        }
      \`,
        }}
      />

      <div className="relative z-[999999]">
        <ToastNotifications
          toasts={toasts}
          removeToast={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
        />
      </div>`;

// 1. Remove badBlock from its current location
if (c.includes(badBlock)) {
  c = c.replace(badBlock + '\n', '');
  c = c.replace(badBlock, '');
} else {
  console.log("WARNING: Could not find badBlock to remove.");
}

// 2. Insert badBlock at the true end of FinanceiroPageContent
const targetEnd = `        />
      )}
    </div>
  );
}

function MetricCard({`;

const replacementEnd = `        />
      )}

${badBlock}
    </div>
  );
}

function MetricCard({`;

if (c.includes(targetEnd)) {
  c = c.replace(targetEnd, replacementEnd);
  fs.writeFileSync('app/admin/settings/financeiro_pessoal/page.tsx', c, 'utf8');
  console.log("Successfully moved badBlock to end of FinanceiroPageContent");
} else {
  console.log("ERROR: Could not find targetEnd!");
}
