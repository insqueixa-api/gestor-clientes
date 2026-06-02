const fs = require('fs');
let c = fs.readFileSync('app/admin/settings/financeiro_pessoal/page.tsx', 'utf8');

// The block to move
const badBlock = `{/* CSS PARA OCULTAR VALORES COM O EYE-TOGGLE */}
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

if (c.includes(badBlock)) {
  c = c.replace(badBlock, ""); // remove from top
  
  // Insert at the bottom, just before the final two </div> closing tags of the component.
  // Let's find the `</Suspense>` closing tag if it's there. No, this is inside `FinanceiroPageContent`.
  // The component ends with `</div>\n  );\n}\n\n`
  const endBlock = "</div>\n  );\n}\n";
  const newEndBlock = `  <div className="h-24 sm:h-20" />
      ${badBlock}
    </div>
  );
}
`;
  
  // I will replace the LAST occurrence of `</div>\n  );\n}` using lastIndexOf
  const lastIdx = c.lastIndexOf("</div>\n  );\n}");
  if (lastIdx !== -1) {
    c = c.substring(0, lastIdx) + newEndBlock + c.substring(lastIdx + 16);
    fs.writeFileSync('app/admin/settings/financeiro_pessoal/page.tsx', c, 'utf8');
    console.log('Moved Toast and Style to the bottom.');
  } else {
    console.log('Could not find end of FinanceiroPageContent.');
  }
} else {
  console.log('Could not find badBlock at the top.');
}
