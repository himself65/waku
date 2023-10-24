// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import { a } from 'react-server-only'
import { Counter } from "./Counter.js";

const App = ({ name }: { name: string }) => {
  return (
    <div style={{ border: "3px red dashed", margin: "1em", padding: "1em" }}>
      <h1>Hello {name}!!</h1>
      <h3>{a}</h3>
      <Counter/>
    </div>
  );
};

export default App;
