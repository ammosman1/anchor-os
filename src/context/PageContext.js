// src/context/PageContext.js
// Lets any screen register what entity it's currently displaying so
// FloatingAdvisor can inject page-specific context into AI prompts.
import React, { createContext, useContext, useState } from 'react';

const PageContext = createContext({ pageContext: null, setPageContext: () => {} });

export function PageContextProvider({ children }) {
  const [pageContext, setPageContext] = useState(null);
  return (
    <PageContext.Provider value={{ pageContext, setPageContext }}>
      {children}
    </PageContext.Provider>
  );
}

export const usePageContext = () => useContext(PageContext);
