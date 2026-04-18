import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";
import { fetchDiscrepancyInvoices, fetchInvoiceByVNo, fetchInvoiceItems, getData, getInvoiceByGSTVno, getInvoiceItems, getInvoiceItemsByVdt } from "./actions/fetchQueries.js";
import { insertData, insertResolvedInvoice } from "./actions/insertQueries.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

let isRunning = false;

async function runJob() {
  if (isRunning) return;

  isRunning = true;
  console.log("Running auto sync...");

  try {
    await processInvoices();
    console.log("Sync done ✅");
  } catch (err) {
    console.error("Sync failed ❌", err);
  } finally {
    isRunning = false;
  }
}

async function processInvoices(Vno) {
  const invoices = await getData(Vno);

  if (!invoices.length) {
    console.log("No new invoices");
    return;
  }

  const chunkSize = 10;

  for (let i = 0; i < invoices.length; i += chunkSize) {
    const chunk = invoices.slice(i, i + chunkSize);

    const results = await Promise.all(
      chunk.map(async (invoice) => {
        try {
          const VNo = invoice["VNo"];
          const Vdt = invoice["Dated"];

          const billItems = await getInvoiceItems(VNo, Vdt);

          return {
            ...invoice,
            items: billItems,
          };
        } catch (err) {
          console.error("Failed invoice:", invoice["Bill No"], err);
          return null;
        }
      })
    );


    const filtered = results.filter(Boolean);

    await insertData(filtered);

    console.log(`Inserted chunk ${i / chunkSize + 1}`);
  };
}

app.get("/", (req, res) => {
  res.send("API running on 4000🚀");
});

app.get("/invoice", async (req, res) => {
  const invoices = await getData();
  res.json(invoices);
});

app.get("/discrepancyInvoice", async (req, res) => {
  const invoices = await fetchDiscrepancyInvoices();
  res.json(invoices);
});

app.get("/discrepancyInvoice/Vno/:Vno", async (req, res) => {

  try {
    const { Vno } = req.params;
    console.log("Fetching invoice for VNo:", Vno);
    const invoice = await fetchInvoiceByVNo(Vno);
    const items = await fetchInvoiceItems(Vno);
    res.json({
      success: true,
      invoice: invoice.data,
      items: items.data
    });
  } catch (error) {
    console.error("Error: ", error);
    res.json({
      success: flse,
      message: "Failed to fetch invoice details"
    });
  }
});

app.get("/resolvedInvoice/GSTVno/:GSTVno", async (req, res) => {

  try {
    const { GSTVno } = req.params;
    const invoice = await getInvoiceByGSTVno(GSTVno);
    const items = await getInvoiceItemsByVdt(invoice[0].VNo, invoice[0].Dated);

    await insertResolvedInvoice(invoice[0], items);

    res.json({
      success: true,
      message: `Invoice ${GSTVno} resolved and inserted successfully`
    });
  } catch (error) {
    console.error("Error: ", error);
    res.json({
      success: flse,
      message: "Failed to fetch invoice details"
    });
  }
});

app.get("/invoice/complete/:Vno", async (req, res) => {
  try {
    const { Vno } = req.params;

    console.log("Fetching complete invoice for Vno:", Vno);
    const invoices = await getData(Vno);

    console.log(`Fetched ${invoices.length} invoices for Vno: ${Vno}`);

    const finalData = await Promise.all(
      invoices.map(async (invoice) => {

        const billItems = await getInvoiceItems(invoice.VNo, invoice["Dated"]);

        return {
          ...invoice,
          items: billItems,
        };
      })
    );

    res.json(finalData);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/invoices/new", async (req, res) => {
  try {
    const { Vno } = req.params;

    const invoices = await getData();

    console.log(`Fetched ${invoices.length} invoices`);

    const finalData = await Promise.all(
      invoices.map(async (invoice) => {

        const billItems = await getInvoiceItems(invoice.VNo, invoice["Dated"]);

        return {
          ...invoice,
          items: billItems,
        };
      })
    );

    res.json(finalData);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/invoice/insert/:GSTVno", async (req, res) => {

  const { GSTVno } = req.params;

  try {
    await processInvoices(GSTVno);
    res.json({ message: "Data inserted successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(4000, () => {
  console.log("Server running on port 4000");
  runJob();
  setInterval(runJob, 5 * 60 * 1000);
});