const fs = require('fs');
let c = fs.readFileSync('app/admin/settings/financeiro_pessoal/page.tsx', 'utf8');

const target = `        {showDatePicker && (
          <ModalDatePicker
            currentDate={currentDate}
            onSelect={(date) => {
              setCurrentDate(date);
              setShowDatePicker(false);
            }}
            onClose={() => setShowDatePicker(false)}
          />
        )}
      </div>`;

const replacement = `        {showDatePicker && (
          <ModalDatePicker
            currentDate={currentDate}
            onSelect={(date) => {
              setCurrentDate(date);
              setShowDatePicker(false);
            }}
            onClose={() => setShowDatePicker(false)}
          />
        )}
        </div>
      </div>`;

if (c.includes(target)) {
  c = c.replace(target, replacement);
  fs.writeFileSync('app/admin/settings/financeiro_pessoal/page.tsx', c, 'utf8');
  console.log('Fixed missing div closing tag in financeiro_pessoal');
} else {
  console.log('Target not found!');
}
