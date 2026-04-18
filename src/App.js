import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";

function App() {
  const [data, setData] = useState([]);
  const [vehicle, setVehicle] = useState("trekcampers");
  const [adjustment, setAdjustment] = useState(5);
  const [location, setLocation] = useState("");
  const [selectedDate, setSelectedDate] = useState("");

  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const normalize = (v) => (v ? v.toLowerCase().trim() : "");

  // ✅ FIXED DATE PARSER (VERY IMPORTANT)
  const parseDate = (str) => {
    if (!str) return null;

    let d = new Date(str);
    if (!isNaN(d)) return d;

    const parts = str.split("/");
    if (parts.length === 3) {
      const [m, day, y] = parts;
      d = new Date(`${y}-${m}-${day}`);
      if (!isNaN(d)) return d;
    }

    return null;
  };

  // ✅ LOAD CSV
  useEffect(() => {
    Papa.parse("/dataset_FINAL_SAFE.csv", {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const cleaned = result.data.map((row) => {
          const parsed = parseDate(row.pickup_date);

          return {
            dateObj: parsed,
            dateKey: parsed
              ? parsed.toISOString().split("T")[0]
              : null,
            company: normalize(row.company),
            vehicle: normalize(row.vehicle),
            price: Number(row.price),
            location: normalize(row.location),
            type: normalize(row.type)
          };
        });

        const finalData = cleaned.filter(
          (d) => d.dateKey && d.price && d.company
        );

        console.log("DATA LOADED:", finalData.length);
        console.log(finalData.slice(0, 5));

        setData(finalData);
      }
    });
  }, []);

  // ✅ COMPETITOR MAP
  const competitorMap = {
    trekcampers: ["stationwagen", "sleeper", "aventus2"],
    tandem: ["beta2s"],
    tandemdeluxe: ["deuce"],
    quad: ["doubledown", "highball", "delite", "condo", "rover"],
    sixer: ["bigsix", "doubleup"]
  };

  const [latest, setLatest] = useState({ grouped: {}, labels: [] });

  // ✅ MAIN LOGIC
  useEffect(() => {
    if (!data.length) return;

    const grouped = {};

    data.forEach((row) => {
      const date = row.dateKey;
      if (!date) return;

      // LOCATION FILTER
      if (location && row.location !== normalize(location)) return;

      // DATE FILTER (SAFE)
      if (selectedDate) {
        const selected = new Date(selectedDate)
          .toISOString()
          .split("T")[0];
        if (date !== selected) return;
      }

      if (!grouped[date]) {
        grouped[date] = { elements: null, competitors: [], rows: [] };
      }

      const v = row.vehicle;
      const c = row.company;

      // ELEMENTS
      if (c === "elementsworld") {
        if (
          (vehicle === "trekcampers" &&
            (v.includes("trek") ||
              v.includes("budget") ||
              v.includes("medium") ||
              v.includes("large"))) ||
          (vehicle === "tandem" &&
            v.includes("tandem") &&
            !v.includes("deluxe")) ||
          (vehicle === "tandemdeluxe" && v.includes("deluxe")) ||
          (vehicle === "quad" && v.includes("quad")) ||
          (vehicle === "sixer" && v.includes("six"))
        ) {
          grouped[date].elements = row.price;
        }
      }

      // COMPETITORS
      if (c !== "elementsworld") {
        const comps = competitorMap[vehicle] || [];

        if (comps.some((comp) => v.includes(comp))) {
          grouped[date].competitors.push(row.price);
          grouped[date].rows.push(row);
        }
      }
    });

    const labels = Object.keys(grouped).sort();

    const elementsData = [];
    const avgData = [];
    const recData = [];

    let last = null;

    labels.forEach((d) => {
      const g = grouped[d];

      const avg =
        g.competitors.length > 0
          ? g.competitors.reduce((a, b) => a + b, 0) /
            g.competitors.length
          : 0;

      if (g.elements !== null) {
        last = g.elements;
        elementsData.push(g.elements);
      } else {
        elementsData.push(last);
      }

      avgData.push(avg);
      recData.push(avg + (avg * adjustment) / 100);
    });

    // CHART
    if (chartInstance.current) chartInstance.current.destroy();

    chartInstance.current = new window.Chart(chartRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Elements", data: elementsData, borderColor: "blue" },
          { label: "Competitor Avg", data: avgData, borderColor: "green" },
          {
            label: "Recommended",
            data: recData,
            borderColor: "red",
            borderDash: [5, 5]
          }
        ]
      }
    });

    setLatest({ grouped, labels });
  }, [data, vehicle, adjustment, location, selectedDate]);

  // KPI
  let latestData = { elements: null, competitors: [], rows: [] };

  for (let i = latest.labels.length - 1; i >= 0; i--) {
    const d = latest.grouped[latest.labels[i]];
    if (d && (d.elements !== null || d.competitors.length > 0)) {
      latestData = d;
      break;
    }
  }

  const avg =
    latestData.competitors.length > 0
      ? latestData.competitors.reduce((a, b) => a + b, 0) /
        latestData.competitors.length
      : 0;

  const lowest =
    latestData.competitors.length > 0
      ? Math.min(...latestData.competitors)
      : 0;

  const recPrice = avg + (avg * adjustment) / 100;

  return (
    <div className="app">
      <h2>🚐 Pricing Dashboard</h2>

      <div className="filters">
        <select onChange={(e) => setVehicle(e.target.value)}>
          <option value="trekcampers">Trek Campers</option>
          <option value="tandem">Tandem</option>
          <option value="tandemdeluxe">Tandem Deluxe</option>
          <option value="quad">Quad</option>
          <option value="sixer">Sixter</option>
        </select>

        <select onChange={(e) => setLocation(e.target.value)}>
          <option value="">All Locations</option>
          <option value="auckland">Auckland</option>
          <option value="christchurch">Christchurch</option>
        </select>

        <input type="date" onChange={(e) => setSelectedDate(e.target.value)} />

        <input
          type="number"
          value={adjustment}
          onChange={(e) => setAdjustment(Number(e.target.value))}
        />
      </div>

      <div className="cards">
        <div className="card">
          <h4>Lowest</h4>
          <p>${lowest.toFixed(2)}</p>
        </div>

        <div className="card">
          <h4>Average</h4>
          <p>${avg.toFixed(2)}</p>
        </div>

        <div className="card">
          <h4>Elements</h4>
          <p>{latestData.elements ? `$${latestData.elements}` : "No Data"}</p>
        </div>

        <div className="card">
          <h4>Recommended</h4>
          <p>${recPrice.toFixed(2)}</p>
        </div>
      </div>

      <div className="chart-container">
        <canvas ref={chartRef}></canvas>
      </div>

      <div className="table-container">
        <h3>Competitors</h3>
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Vehicle</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {latestData.rows.map((r, i) => (
              <tr key={i}>
                <td>{r.company}</td>
                <td>{r.vehicle}</td>
                <td>${r.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;