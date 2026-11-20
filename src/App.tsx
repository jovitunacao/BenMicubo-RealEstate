/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {PropertyStoreProvider} from './context/PropertyStoreContext';
import {Header} from './components/Header';
import {Footer} from './components/Footer';
import {HomePage} from './pages/HomePage';
import {PropertyDetailPage} from './pages/PropertyDetailPage';
import {DossierPrintPage} from './pages/DossierPrintPage';
import {SignagePrintPage} from './pages/SignagePrintPage';
import {AdminDashboardPage} from './pages/AdminDashboardPage';

export default function App() {
  return (
    <PropertyStoreProvider>
      <BrowserRouter>
        <div className="min-h-screen flex flex-col bg-white text-[#202124]">
          <Header />
          <div className="flex-1">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/property/:lotId" element={<PropertyDetailPage />} />
              <Route path="/dossier/:lotId" element={<DossierPrintPage />} />
              <Route path="/signage/:lotId" element={<SignagePrintPage />} />
              <Route path="/admin" element={<AdminDashboardPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
          <Footer />
        </div>
      </BrowserRouter>
    </PropertyStoreProvider>
  );
}
