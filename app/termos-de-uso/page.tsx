// app/termos-de-uso/page.tsx
import type { Metadata } from "next";
import LegalLayout from "@/components/legal/LegalLayout";

export const metadata: Metadata = {
  title: "Termos de Uso — UniGestor",
  description: "Termos de Uso do sistema UniGestor.",
};

export default function TermosDeUsoPage() {
  return (
    <LegalLayout
      title="Termos de Uso"
      sinceDate="28 de dezembro de 2025"
      lastUpdated="14 de agosto de 2026"
    >
      <p>
        Estes Termos de Uso regulam o acesso e a utilização do{" "}
        <strong>UniGestor</strong> ("Sistema", "Portal"), disponibilizado por{" "}
        <strong>MARCIO MARTINS</strong>, inscrito como Microempreendedor
        Individual (MEI) sob o CNPJ 58.024.281/0001-00 ("Prestador", "nós").
        Ao criar uma conta, acessar o Portal
        do Cliente ou utilizar qualquer funcionalidade do Sistema, você
        ("Cliente", "Usuário") declara que leu, entendeu e concorda com estes
        Termos.
      </p>
      <p>
        Se você não concorda com algum ponto destes Termos, pedimos que não
        utilize o Sistema e entre em contato conosco para esclarecer suas
        dúvidas.
      </p>

      <h2>1. O que é o UniGestor</h2>
      <p>
        O UniGestor é a <strong>ferramenta de gestão</strong> do Prestador:
        cadastro de clientes, cobranças, renovações, suporte e configuração
        dos serviços contratados. Ele não é provedor de conteúdo nem
        distribuidor de sinal — é o painel e o portal de autoatendimento que
        dão suporte à atividade do Prestador, cujo cadastro de MEI cobre
        serviços técnicos (manutenção de computadores, instalação e
        configuração de equipamentos e aplicativos, redes e suporte em
        informática).
      </p>

      <h2>2. Cadastro e Acesso</h2>
      <p>
        O acesso ao Portal do Cliente é feito por meio de um link/token
        pessoal associado ao seu número de WhatsApp cadastrado, ou, no caso
        de usuários administrativos, por e-mail e senha. Você é responsável
        por:
      </p>
      <ul>
        <li>Manter seus dados de contato atualizados junto ao Prestador;</li>
        <li>
          Não compartilhar seu link de acesso, token ou credenciais com
          terceiros;
        </li>
        <li>
          Avisar imediatamente o Prestador caso suspeite de uso indevido da
          sua conta.
        </li>
      </ul>

      <h2>3. Natureza dos Serviços Contratados</h2>
      <p>
        Os serviços cobrados e gerenciados através do UniGestor consistem no{" "}
        <strong>
          fornecimento de acesso, suporte técnico, configuração e manutenção
        </strong>{" "}
        de aplicativos nos dispositivos do Cliente, incluindo orientação de
        instalação, atualização de credenciais e resolução de problemas de
        configuração.
      </p>
      <p>
        Os aplicativos utilizados para a prestação do serviço são
        desenvolvidos e mantidos por empresas terceiras, alheias ao
        Prestador, e sujeitos às condições de disponibilidade e
        funcionamento definidas por elas. O Prestador não tem controle sobre
        alterações, instabilidades ou descontinuação desses aplicativos por
        parte de seus desenvolvedores.
      </p>

      <h2>4. Pagamentos e Renovação</h2>
      <p>
        As mensalidades referem-se aos serviços descritos na Seção 3 e
        devem ser pagas conforme o plano e a forma de pagamento
        combinados com o Prestador. O Portal do Cliente permite consultar
        vencimentos, histórico de pagamentos e realizar a renovação da
        assinatura.
      </p>
      <p>
        Cupons de desconto, quando disponibilizados, têm regras próprias de
        uso (validade, limite por conta, elegibilidade) exibidas no momento
        da aplicação e podem ser alterados ou descontinuados a qualquer
        momento, sem aviso prévio.
      </p>
      <p>
        O atraso no pagamento pode resultar na suspensão do suporte e da
        configuração do(s) aplicativo(s) associados à sua conta até a
        regularização.
      </p>

      <h2>5. Cancelamento</h2>
      <p>
        Você pode solicitar o cancelamento do seu plano a qualquer momento,
        pelo Portal do Cliente ou diretamente com o Prestador. O
        cancelamento encerra a prestação do suporte e a manutenção do
        acesso configurado, não gerando reembolso de período já utilizado,
        salvo acordo em contrário.
      </p>

      <h2>6. Uso Aceitável</h2>
      <p>Ao utilizar o Sistema, você concorda em não:</p>
      <ul>
        <li>
          Tentar acessar áreas, contas ou dados de outros usuários sem
          autorização;
        </li>
        <li>
          Utilizar o Portal para fins diferentes do acompanhamento da sua
          própria assinatura e do suporte contratado;
        </li>
        <li>
          Tentar comprometer a segurança, o funcionamento ou a
          disponibilidade do Sistema (incluindo engenharia reversa,
          automação não autorizada ou sobrecarga proposital);
        </li>
        <li>
          Utilizar informações obtidas pelo Sistema para fins ilícitos.
        </li>
      </ul>

      <h2>7. Propriedade Intelectual</h2>
      <p>
        A marca "UniGestor", o layout, o código e as funcionalidades do
        Sistema pertencem ao Prestador e não podem ser copiados,
        reproduzidos ou utilizados sem autorização prévia. Isso não se
        aplica a marcas, aplicativos ou conteúdos de terceiros mencionados
        ou configurados através do Sistema, que permanecem de propriedade
        de seus respectivos titulares.
      </p>

      <h2>8. Limitação de Responsabilidade</h2>
      <p>
        O Prestador envida seus melhores esforços para manter o Sistema
        disponível e o suporte funcionando, mas não garante disponibilidade
        ininterrupta, e não se responsabiliza por:
      </p>
      <ul>
        <li>
          Indisponibilidade, instabilidade ou alterações em aplicativos de
          terceiros configurados através do suporte prestado;
        </li>
        <li>
          Problemas decorrentes da conexão de internet, dispositivo ou rede
          do Cliente;
        </li>
        <li>
          Uso indevido de credenciais ou links de acesso compartilhados pelo
          próprio Cliente com terceiros.
        </li>
      </ul>

      <h2>9. Alterações destes Termos</h2>
      <p>
        Estes Termos podem ser atualizados periodicamente para refletir
        mudanças no Sistema ou na forma de prestação dos serviços. A versão
        vigente estará sempre disponível nesta página, com a data da última
        atualização indicada no topo.
      </p>

      <h2>10. Lei Aplicável e Foro</h2>
      <p>
        Estes Termos são regidos pelas leis da República Federativa do
        Brasil. Fica eleito o foro do domicílio do Cliente para dirimir
        eventuais controvérsias decorrentes destes Termos.
      </p>

      <h2>11. Contato</h2>
      <p>
        Dúvidas sobre estes Termos podem ser enviadas ao Prestador, MARCIO
        MARTINS (MEI), CNPJ 58.024.281/0001-00, pelo WhatsApp/telefone{" "}
        <a href="tel:+5521992347771">+55 (21) 99234-7771</a> ou pelo e-mail{" "}
        <a href="mailto:unigestorbr@gmail.com">unigestorbr@gmail.com</a>.
      </p>
    </LegalLayout>
  );
}
