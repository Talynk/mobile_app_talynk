import React, { createContext, useContext, useState } from 'react';

type CreateFocusContextType = {
  isCreateFocused: boolean;
  setCreateFocused: (value: boolean) => void;
};

const CreateFocusContext = createContext<CreateFocusContextType>({
  isCreateFocused: false,
  setCreateFocused: () => {},
});

export function CreateFocusProvider({ children }: { children: React.ReactNode }) {
  const [isCreateFocused, setCreateFocused] = useState(false);
  return (
    <CreateFocusContext.Provider value={{ isCreateFocused, setCreateFocused }}>
      {children}
    </CreateFocusContext.Provider>
  );
}

export function useCreateFocus() {
  return useContext(CreateFocusContext);
}
