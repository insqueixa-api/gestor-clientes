// app/politica-de-privacidade/page.tsx
import type { Metadata } from "next";
import LegalLayout from "@/components/legal/LegalLayout";

export const metadata: Metadata = {
  title: "Política de Privacidade — UniGestor",
  description: "Política de Privacidade do sistema UniGestor.",
};

export default function PoliticaDePrivacidadePage() {
  return (
    <LegalLayout
      title="Política de Privacidade"
      sinceDate="28 de dezembro de 2025"
      lastUpdated="14 de agosto de 2026"
    >
      <p>
        Esta Política de Privacidade explica como{" "}
        <strong>MARCIO MARTINS</strong>, Microempreendedor Individual (MEI),
        CNPJ 58.024.281/0001-00 ("Prestador", "nós"), coleta, usa e protege
        os dados pessoais de quem utiliza o{" "}
        <strong>UniGestor</strong> ("Sistema"), seja através do painel
        administrativo ou do Portal do Cliente. Ela segue os princípios da
        Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>

      <h2>1. Quem é o controlador dos dados</h2>
      <p>
        O controlador dos dados tratados pelo UniGestor é MARCIO MARTINS
        (MEI), CNPJ 58.024.281/0001-00. Por se tratar de um MEI, o próprio
        Prestador é o responsável direto pelo tratamento e pelas respostas a
        eventuais solicitações relacionadas aos seus dados.
      </p>

      <h2>2. Quais dados coletamos</h2>
      <p>Coletamos o mínimo necessário para prestar o serviço:</p>
      <ul>
        <li>
          <strong>Identificação:</strong> nome e número de WhatsApp — os
          únicos dados pessoais que mantemos sobre você;
        </li>
        <li>
          <strong>Plano e pagamentos:</strong> valores, vencimentos e
          histórico de pagamentos dos serviços contratados;
        </li>
        <li>
          <strong>Dados dos aplicativos:</strong> informações técnicas
          necessárias para configurar e dar suporte ao(s) aplicativo(s)
          contratado(s) (ex.: identificador do dispositivo, status da
          configuração).
        </li>
      </ul>

      <h2>3. Para que usamos seus dados</h2>
      <ul>
        <li>Viabilizar seu acesso e uso do Portal do Cliente;</li>
        <li>
          Prestar o suporte técnico e a configuração dos serviços
          contratados;
        </li>
        <li>
          Gerenciar cobranças, vencimentos, renovações e cupons de
          desconto;
        </li>
        <li>
          Enviar avisos operacionais por WhatsApp (ex.: lembrete de
          vencimento, confirmação de pagamento, status de solicitações);
        </li>
        <li>
          Manter a segurança do Sistema e prevenir uso indevido ou fraude;
        </li>
        <li>Cumprir obrigações legais e fiscais aplicáveis ao Prestador.</li>
      </ul>
      <p>
        Não utilizamos seus dados para fins de publicidade de terceiros nem
        os vendemos a outras empresas.
      </p>

      <h2>4. Base legal (LGPD)</h2>
      <p>
        O tratamento de dados descrito acima se baseia principalmente na{" "}
        <strong>execução do contrato/serviço</strong> firmado entre você e o
        Prestador (art. 7º, V, LGPD) e no{" "}
        <strong>legítimo interesse</strong> do Prestador em manter o
        atendimento e a segurança do Sistema (art. 7º, IX, LGPD). Quando
        aplicável — como no envio de comunicações não estritamente
        operacionais —, o tratamento se baseia em seu{" "}
        <strong>consentimento</strong>, que pode ser revogado a qualquer
        momento.
      </p>

      <h2>5. Com quem compartilhamos dados</h2>
      <p>
        Nunca compartilhamos seus dados pessoais (nome e WhatsApp) com
        terceiros. A única exceção envolve os dados dos aplicativos
        contratados: para prestar o suporte, nós mesmos configuramos esse
        acesso diretamente nos sistemas externos dos aplicativos — não se
        trata de compartilhamento de dados com terceiros, e sim da
        configuração do próprio serviço contratado.
      </p>

      <h2>6. Por quanto tempo guardamos seus dados</h2>
      <p>
        Mantemos seus dados enquanto durar sua relação com o Prestador.
        Após o fim dessa relação, os dados são excluídos automaticamente em
        até 60 dias.
      </p>

      <h2>7. Segurança</h2>
      <p>
        Adotamos medidas técnicas e administrativas para proteger seus
        dados, como controle de acesso por autenticação, criptografia em
        trânsito e restrição de quem, dentro da operação do Prestador, pode
        visualizar cada tipo de informação. Nenhum sistema é 100% imune a
        incidentes, mas trabalhamos para reduzir esse risco continuamente.
      </p>

      <h2>8. Seus direitos como titular</h2>
      <p>Conforme o art. 18 da LGPD, você pode solicitar ao Prestador:</p>
      <ul>
        <li>Confirmação de que tratamos seus dados;</li>
        <li>Acesso aos dados que temos sobre você;</li>
        <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
        <li>
          Anonimização, bloqueio ou eliminação de dados desnecessários ou
          tratados em desconformidade com a lei;
        </li>
        <li>Portabilidade dos dados, quando aplicável;</li>
        <li>
          Revogação do consentimento e informação sobre com quem
          compartilhamos seus dados.
        </li>
      </ul>
      <p>
        Essas solicitações podem ser feitas pelos canais de atendimento
        informados no Portal do Cliente ou diretamente ao Prestador.
      </p>

      <h2>9. Menores de idade</h2>
      <p>
        O Sistema não se destina a menores de 18 anos. Se você é
        responsável legal por um menor e identificar dados dele em nossa
        base sem autorização, entre em contato para que possamos removê-los.
      </p>

      <h2>10. Alterações desta Política</h2>
      <p>
        Esta Política pode ser atualizada periodicamente para refletir
        mudanças no Sistema ou na legislação aplicável. A versão vigente
        estará sempre disponível nesta página, com a data da última
        atualização indicada no topo.
      </p>

      <h2>11. Contato</h2>
      <p>
        Para dúvidas sobre esta Política ou para exercer seus direitos como
        titular de dados, entre em contato com MARCIO MARTINS (MEI), CNPJ
        58.024.281/0001-00, pelo WhatsApp/telefone{" "}
        <a href="tel:+5521992347771">+55 (21) 99234-7771</a> ou pelo e-mail{" "}
        <a href="mailto:unigestorbr@gmail.com">unigestorbr@gmail.com</a>.
      </p>
    </LegalLayout>
  );
}
