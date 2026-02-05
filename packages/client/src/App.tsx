import { Routes, Route } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Layout } from '@/components/layout/Layout';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Accounts } from '@/pages/Accounts';
import { Transactions } from '@/pages/Transactions';
import { Reconciliation } from '@/pages/Reconciliation';
import { Uploads } from '@/pages/Uploads';
import { Investments } from '@/pages/Investments';
import { MutualFunds } from '@/pages/MutualFunds';
import { Loans } from '@/pages/Loans';
import { LoanGivenDetails } from '@/pages/LoanGivenDetails';
import { Reports } from '@/pages/Reports';
import { Settings } from '@/pages/Settings';
import { CreditCards } from '@/pages/CreditCards';

function App() {
  return (
    <TooltipProvider>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />

        {/* Protected routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="gearup" element={<Dashboard />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="credit-cards" element={<CreditCards />} />
          <Route path="reconciliation" element={<Reconciliation />} />
          <Route path="uploads" element={<Uploads />} />
          <Route path="investments" element={<Investments />} />
          <Route path="investments/mutual-funds" element={<MutualFunds />} />
          <Route path="loans" element={<Loans />} />
          <Route path="loans/:id/details" element={<LoanGivenDetails />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </TooltipProvider>
  );
}

export default App;
