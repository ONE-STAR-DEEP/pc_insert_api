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

async function processInvoices(Vno, Vtyp) {
  
  let invoices;

  if(Vtyp){

    invoices = await getData(Vtyp, Vno);

  } else {   
    const invoicesS1 = await getData("S1", Vno);
    const invoicesS2 = await getData("S2", Vno);
    const invoicesS3 = await getData("S3", Vno);
    
    invoices = [
      ...invoicesS1,
      ...invoicesS2,
      ...invoicesS3,
  ];
}
  
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
          const Vtyp = invoice["Vtyp"]

          const billItems = await getInvoiceItems(VNo, Vtyp, Vdt);

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

    const [Vtyp, VNo] = Vno.split("-") 

    const invoice = await fetchInvoiceByVNo(VNo, Vtyp);
    const items = await fetchInvoiceItems(VNo, Vtyp);
    res.json({
      success: true,
      invoice: invoice.data,
      items: items.data
    });
  } catch (error) {
    console.error("Error: ", error);
    res.json({
      success: false,
      message: "Failed to fetch invoice details"
    });
  }
});

app.get("/resolvedInvoice/GSTVno/:GSTVno", async (req, res) => {

  try {
    const { GSTVno } = req.params;
    const invoice = await getInvoiceByGSTVno(GSTVno);
    const items = await getInvoiceItemsByVdt(invoice[0].VNo, invoice[0].Vtyp, invoice[0].Dated);

    await insertResolvedInvoice(invoice[0], items);

    res.json({
      success: true,
      message: `Invoice ${GSTVno} resolved and inserted successfully`
    });
  } catch (error) {
    console.error("Error: ", error);
    res.json({
      success: false,
      message: "Failed to fetch invoice details"
    });
  }
});

app.get("/invoice/complete/:Vno", async (req, res) => {
  try {
    const { Vno } = req.params;

    const [Vtyp, newVno] = Vno.split('-');

    console.log("Fetching complete invoice for Vno:", Vno);
    const invoices = await getData(Vtyp, newVno);

    console.log(`Fetched ${invoices.length} invoices for Vno: ${Vno}`);

    const finalData = await Promise.all(
      invoices.map(async (invoice) => {

        const billItems = await getInvoiceItems(invoice.VNo, invoice.Vtyp, invoice["Dated"]);

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

    const invoicesS1 = await getData("S1");
    const invoicesS2 = await getData("S2");
    const invoicesS3 = await getData("S3");

    const invoices = [
      ...invoicesS1,
      ...invoicesS2,
      ...invoicesS3,
    ];

    console.log(`Fetched ${invoices.length} invoices`);

    const finalData = await Promise.all(
      invoices.map(async (invoice) => {

        const billItems = await getInvoiceItems(invoice.VNo, invoice.Vtyp, invoice["Dated"]);

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

app.get("/invoice/insert/:Vno", async (req, res) => {

  const { Vno } = req.params;

  const [Vtyp, newVno] = Vno.split('-');

  try {
    await processInvoices(newVno, Vtyp);
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